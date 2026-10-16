-- ArtGuard Hub: canonical conversations, idempotent sends, and per-user hide
-- Run after schema.sql, fix-direct-chat.sql, and chat-auth-runtime-fix.sql.

alter table public.conversations
  add column if not exists participant_low uuid references auth.users(id) on delete cascade,
  add column if not exists participant_high uuid references auth.users(id) on delete cascade;

alter table public.conversation_participants
  add column if not exists hidden_at timestamptz;

alter table public.messages
  add column if not exists client_message_id uuid;

-- Consolidate only exact two-person duplicates. Message rows are moved before
-- duplicate conversation rows are removed; their complete history is retained.
do $$
declare
  v_duplicate record;
  v_keeper uuid;
begin
  for v_duplicate in
    with exact_pairs as (
      select
        c.id as conversation_id,
        (array_agg(cp.user_id order by cp.user_id))[1] as participant_low,
        (array_agg(cp.user_id order by cp.user_id))[2] as participant_high,
        c.updated_at,
        c.created_at
      from public.conversations c
      join public.conversation_participants cp on cp.conversation_id = c.id
      group by c.id, c.updated_at, c.created_at
      having count(*) = 2 and count(distinct cp.user_id) = 2
    ), duplicate_pairs as (
      select
        participant_low,
        participant_high,
        array_agg(conversation_id order by updated_at desc, created_at desc, conversation_id desc) as ids
      from exact_pairs
      group by participant_low, participant_high
      having count(*) > 1
    )
    select ids from duplicate_pairs
  loop
    v_keeper := v_duplicate.ids[1];

    update public.messages m
    set conversation_id = v_keeper
    where m.conversation_id = any(v_duplicate.ids)
      and m.conversation_id <> v_keeper;

    update public.conversations keeper
    set updated_at = greatest(
      keeper.updated_at,
      coalesce((
        select max(c.updated_at)
        from public.conversations c
        where c.id = any(v_duplicate.ids)
      ), keeper.updated_at),
      coalesce((
        select max(m.created_at)
        from public.messages m
        where m.conversation_id = v_keeper
      ), keeper.updated_at)
    )
    where keeper.id = v_keeper;

    delete from public.conversations c
    where c.id = any(v_duplicate.ids)
      and c.id <> v_keeper;
  end loop;
end;
$$;

-- Tag every exact 1-to-1 conversation. Partial nulls are reserved for legacy
-- conversations with a nonstandard participant count and are not pair-unique.
update public.conversations c
set participant_low = pairs.participant_low,
    participant_high = pairs.participant_high
from (
  select
    cp.conversation_id,
    (array_agg(cp.user_id order by cp.user_id))[1] as participant_low,
    (array_agg(cp.user_id order by cp.user_id))[2] as participant_high
  from public.conversation_participants cp
  group by cp.conversation_id
  having count(*) = 2 and count(distinct cp.user_id) = 2
) pairs
where c.id = pairs.conversation_id
  and (c.participant_low is distinct from pairs.participant_low
    or c.participant_high is distinct from pairs.participant_high);

create unique index if not exists conversations_participant_pair_unique_idx
  on public.conversations(participant_low, participant_high)
  where participant_low is not null and participant_high is not null;

create index if not exists conversation_participants_user_hidden_idx
  on public.conversation_participants(user_id, hidden_at, conversation_id);

create unique index if not exists messages_sender_client_message_id_unique_idx
  on public.messages(sender_id, client_message_id)
  where client_message_id is not null;

create or replace function public.get_or_create_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_user uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_lock_key bigint;
  v_conversation_id uuid;
begin
  if v_current_user is null then raise exception 'Not authenticated'; end if;
  if p_other_user_id is null or p_other_user_id = v_current_user then
    raise exception 'Invalid recipient';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_other_user_id) then
    raise exception 'Recipient profile not found';
  end if;

  v_low := least(v_current_user, p_other_user_id);
  v_high := greatest(v_current_user, p_other_user_id);
  v_lock_key := hashtextextended(v_low::text || ':' || v_high::text, 1937);
  perform pg_advisory_xact_lock(v_lock_key);

  select c.id into v_conversation_id
  from public.conversations c
  where c.participant_low = v_low
    and c.participant_high = v_high;

  if v_conversation_id is null then
    insert into public.conversations(participant_low, participant_high)
    values (v_low, v_high)
    on conflict (participant_low, participant_high)
      where participant_low is not null and participant_high is not null
    do update set participant_low = excluded.participant_low
    returning id into v_conversation_id;

    insert into public.conversation_participants(conversation_id, user_id)
    values (v_conversation_id, v_low), (v_conversation_id, v_high)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  update public.conversation_participants cp
  set hidden_at = null
  where cp.conversation_id = v_conversation_id
    and cp.user_id = v_current_user
    and cp.hidden_at is not null;

  return v_conversation_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

create or replace function public.hide_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  update public.conversation_participants cp
  set hidden_at = coalesce(cp.hidden_at, now())
  where cp.conversation_id = p_conversation_id
    and cp.user_id = v_user;

  if not found then raise exception 'Not authorized for this conversation'; end if;
end;
$$;

revoke all on function public.hide_conversation(uuid) from public;
grant execute on function public.hide_conversation(uuid) to authenticated;

-- A request UUID makes retries of one client send action return its original
-- row instead of inserting a second message.
drop function if exists public.send_message(uuid, text, text, text, integer, text, text, text);

create or replace function public.send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_kind text default 'text',
  p_text text default null,
  p_image_name text default null,
  p_image_variant integer default null,
  p_file_name text default null,
  p_file_type text default null,
  p_file_size text default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_message public.messages;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_client_message_id is null then raise exception 'Message request id is required'; end if;
  if p_kind not in ('text', 'image', 'file', 'revision') then raise exception 'Invalid message kind'; end if;
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = v_user
      and cp.hidden_at is null
  ) then
    raise exception 'Not an active participant in this conversation';
  end if;

  select m.* into v_message
  from public.messages m
  where m.sender_id = v_user
    and m.client_message_id = p_client_message_id;
  if v_message.id is not null then
    if v_message.conversation_id <> p_conversation_id then
      raise exception 'Message request id was already used';
    end if;
    return v_message;
  end if;

  insert into public.messages(
    conversation_id, sender_id, client_message_id, kind, text,
    image_name, image_variant, file_name, file_type, file_size, status
  ) values (
    p_conversation_id, v_user, p_client_message_id, p_kind, p_text,
    p_image_name, p_image_variant, p_file_name, p_file_type, p_file_size, 'sent'
  )
  on conflict (sender_id, client_message_id)
    where client_message_id is not null
  do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.* into v_message
    from public.messages m
    where m.sender_id = v_user
      and m.client_message_id = p_client_message_id;
    if v_message.conversation_id <> p_conversation_id then
      raise exception 'Message request id was already used';
    end if;
    return v_message;
  end if;

  update public.conversations c
  set updated_at = now()
  where c.id = p_conversation_id;

  return v_message;
end;
$$;

revoke all on function public.send_message(uuid, uuid, text, text, text, integer, text, text, text) from public;
grant execute on function public.send_message(uuid, uuid, text, text, text, integer, text, text, text) to authenticated;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = v_user
      and cp.hidden_at is null
  ) then
    raise exception 'Not an active participant in this conversation';
  end if;

  select coalesce(array_agg(m.id), '{}') into v_ids
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> v_user
    and m.status <> 'read';

  update public.messages m
  set status = 'read'
  where m.id = any(v_ids);

  return v_ids;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;