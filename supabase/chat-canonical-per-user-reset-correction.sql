-- Apply once after chat-fresh-threads-after-deletion.sql and its prerequisites.
-- Keep one canonical conversation per pair, while preserving participant
-- reset boundaries and all existing message and storage object records.

alter table public.conversations
  add column if not exists superseded_by uuid references public.conversations(id) on delete cascade;

do $$
declare
  v_pair record;
  v_ids uuid[];
  v_keeper uuid;
  v_user_id uuid;
  v_reset_at timestamptz;
  v_deleted_at timestamptz;
  v_hidden_at timestamptz;
begin
  for v_pair in
    select c.participant_low, c.participant_high
    from public.conversations c
    where c.participant_low is not null
      and c.participant_high is not null
      and c.superseded_by is null
    group by c.participant_low, c.participant_high
    having count(*) > 1
  loop
    select array_agg(c.id order by c.created_at, c.id)
    into v_ids
    from public.conversations c
    where c.participant_low = v_pair.participant_low
      and c.participant_high = v_pair.participant_high
      and c.superseded_by is null;

    if exists (
      select 1
      from public.conversations c
      left join public.conversation_participants cp on cp.conversation_id = c.id
      where c.id = any(v_ids)
      group by c.id, c.participant_low, c.participant_high
      having count(cp.user_id) <> 2
        or count(distinct cp.user_id) <> 2
        or not bool_and(cp.user_id in (c.participant_low, c.participant_high))
    ) then
      raise exception
        'Cannot reconcile direct conversation pair % / %: a thread does not have exactly the expected two participants',
        v_pair.participant_low, v_pair.participant_high;
    end if;

    v_keeper := v_ids[1];

    for v_user_id in
      select unnest(array[v_pair.participant_low, v_pair.participant_high])
    loop
      select max(cp.reset_at), max(cp.deleted_at), max(cp.hidden_at)
      into v_reset_at, v_deleted_at, v_hidden_at
      from public.conversation_participants cp
      where cp.conversation_id = any(v_ids)
        and cp.user_id = v_user_id;

      update public.conversation_participants cp
      set reset_at = v_reset_at,
          deleted_at = v_deleted_at,
          hidden_at = case
            when exists (
              select 1
              from public.messages m
              where m.conversation_id = any(v_ids)
                and (v_reset_at is null or m.created_at > v_reset_at)
            ) then null
            else v_hidden_at
          end
      where cp.conversation_id = v_keeper
        and cp.user_id = v_user_id;
    end loop;

    -- Message IDs, payloads, timestamps, and attachment object names stay
    -- unchanged. Old attachment paths continue to resolve through the alias.
    update public.messages m
    set conversation_id = v_keeper
    where m.conversation_id = any(v_ids)
      and m.conversation_id <> v_keeper;

    insert into public.conversation_notification_preferences as current_preference (
      conversation_id, user_id, notifications_muted, updated_at
    )
    select distinct on (p.user_id)
      v_keeper, p.user_id, p.notifications_muted, p.updated_at
    from public.conversation_notification_preferences p
    where p.conversation_id = any(v_ids)
    order by p.user_id, p.updated_at desc, (p.conversation_id = v_keeper) desc
    on conflict (conversation_id, user_id)
    do update set notifications_muted = excluded.notifications_muted,
                  updated_at = excluded.updated_at
    where excluded.updated_at > current_preference.updated_at;

    update public.conversations keeper
    set updated_at = greatest(
      keeper.updated_at,
      coalesce((
        select max(c.updated_at)
        from public.conversations c
        where c.id = any(v_ids)
      ), keeper.updated_at),
      coalesce((
        select max(m.created_at)
        from public.messages m
        where m.conversation_id = v_keeper
      ), keeper.updated_at)
    )
    where keeper.id = v_keeper;

    update public.conversations c
    set superseded_by = v_keeper
    where c.id = any(v_ids)
      and c.id <> v_keeper;
  end loop;
end;
$$;

create unique index if not exists conversations_active_participant_pair_unique_idx
  on public.conversations(participant_low, participant_high)
  where participant_low is not null
    and participant_high is not null
    and superseded_by is null;

create or replace function public.get_or_create_active_chat_conversation(
  p_user_id uuid,
  p_other_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_low uuid := least(p_user_id, p_other_user_id);
  v_high uuid := greatest(p_user_id, p_other_user_id);
  v_lock_key bigint;
  v_conversation_id uuid;
begin
  if p_user_id is null or p_other_user_id is null or p_user_id = p_other_user_id then
    raise exception 'Invalid conversation participants';
  end if;

  v_lock_key := hashtextextended(v_low::text || ':' || v_high::text, 1937);
  perform pg_advisory_xact_lock(v_lock_key);

  select c.id into v_conversation_id
  from public.conversations c
  where c.participant_low = v_low
    and c.participant_high = v_high
    and c.superseded_by is null;

  if v_conversation_id is null then
    insert into public.conversations(participant_low, participant_high)
    values (v_low, v_high)
    on conflict (participant_low, participant_high)
      where participant_low is not null
        and participant_high is not null
        and superseded_by is null
    do update set participant_low = excluded.participant_low
    returning id into v_conversation_id;

    insert into public.conversation_participants(conversation_id, user_id)
    values (v_conversation_id, v_low), (v_conversation_id, v_high)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  -- Reopen only the caller's inbox entry; its reset_at history boundary stays.
  update public.conversation_participants
  set hidden_at = null
  where conversation_id = v_conversation_id
    and user_id = p_user_id
    and hidden_at is not null;

  return v_conversation_id;
end;
$$;

revoke all on function public.get_or_create_active_chat_conversation(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.get_or_create_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_other_user_id is null or p_other_user_id = v_user then
    raise exception 'Invalid recipient';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_other_user_id) then
    raise exception 'Recipient profile not found';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_user and b.blocked_user_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_user_id = v_user)
  ) then
    raise exception 'Messaging is unavailable for this user';
  end if;

  return public.get_or_create_active_chat_conversation(v_user, p_other_user_id);
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

create or replace function public.hide_conversation(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reset_at timestamptz := now();
  v_canonical_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select coalesce(c.superseded_by, c.id)
  into v_canonical_id
  from public.conversations c
  join public.conversation_participants cp
    on cp.conversation_id = c.id
   and cp.user_id = v_user
  where c.id = p_conversation_id;
  if v_canonical_id is null then raise exception 'Not authorized for this conversation'; end if;

  update public.conversation_participants
  set hidden_at = v_reset_at,
      reset_at = v_reset_at,
      deleted_at = v_reset_at
  where conversation_id = v_canonical_id
    and user_id = v_user;
  if not found then raise exception 'Not authorized for this conversation'; end if;

  return v_reset_at;
end;
$$;

revoke all on function public.hide_conversation(uuid) from public, anon;
grant execute on function public.hide_conversation(uuid) to authenticated;

create or replace function public.unhide_chat_recipient_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
  set hidden_at = null
  where conversation_id = new.conversation_id
    and user_id <> new.sender_id
    and hidden_at is not null;

  return new;
end;
$$;

revoke all on function public.unhide_chat_recipient_after_message() from public, anon, authenticated;
drop trigger if exists messages_unhide_recipient_after_insert on public.messages;
create trigger messages_unhide_recipient_after_insert
after insert on public.messages
for each row
execute function public.unhide_chat_recipient_after_message();

drop policy if exists "chat participants can read sent attachments" on storage.objects;
create policy "chat participants can read sent attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and exists (
    select 1
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
     and cp.user_id = auth.uid()
    where m.attachment_storage_path = storage.objects.name
      and (
        m.conversation_id::text = (storage.foldername(storage.objects.name))[1]
        or exists (
          select 1
          from public.conversations alias
          where alias.id::text = (storage.foldername(storage.objects.name))[1]
            and alias.superseded_by = m.conversation_id
        )
      )
  )
);

grant select on public.conversation_participants to authenticated;
drop policy if exists "users can read own conversation participant rows"
  on public.conversation_participants;
create policy "users can read own conversation participant rows"
on public.conversation_participants for select
to authenticated
using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_participants'
  ) then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end;
$$;
