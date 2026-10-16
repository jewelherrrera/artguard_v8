-- ArtGuard Hub: per-user chat mutes and reversible user blocks.
-- Apply manually after chat-stabilization.sql, chat-reset-history.sql, and
-- chat-write-security-hardening.sql (with chat-auth-runtime-fix.sql already applied).
-- Does not alter existing conversations, messages, notifications, or user profiles.

create table if not exists public.conversation_notification_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notifications_muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_notification_preferences_user_idx
  on public.conversation_notification_preferences(user_id, conversation_id);

alter table public.conversation_notification_preferences enable row level security;

drop policy if exists "users can read their conversation notification preferences"
  on public.conversation_notification_preferences;
create policy "users can read their conversation notification preferences"
on public.conversation_notification_preferences for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = conversation_notification_preferences.conversation_id
      and cp.user_id = auth.uid()
  )
);

revoke all on public.conversation_notification_preferences from public, anon, authenticated;
grant select on public.conversation_notification_preferences to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_notification_preferences'
  ) then
    alter publication supabase_realtime add table public.conversation_notification_preferences;
  end if;
end
$$;

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_user_id)
);

create index if not exists user_blocks_blocked_user_idx
  on public.user_blocks(blocked_user_id, blocker_id);

alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from public, anon, authenticated;

create or replace function public.set_my_conversation_muted(
  p_conversation_id uuid,
  p_muted boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_muted is null then raise exception 'Mute preference is required'; end if;
  if not exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = v_user
      and cp.hidden_at is null
  ) then
    raise exception 'Not an active participant in this conversation';
  end if;

  insert into public.conversation_notification_preferences (
    conversation_id, user_id, notifications_muted, updated_at
  ) values (
    p_conversation_id, v_user, p_muted, now()
  )
  on conflict (conversation_id, user_id)
  do update set notifications_muted = excluded.notifications_muted,
                updated_at = excluded.updated_at;

  return p_muted;
end;
$$;

revoke all on function public.set_my_conversation_muted(uuid, boolean) from public, anon;
grant execute on function public.set_my_conversation_muted(uuid, boolean) to authenticated;

create or replace function public.set_my_chat_block(
  p_other_user_id uuid,
  p_blocked boolean
)
returns table(blocked_by_me boolean, messaging_unavailable boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_other_user_id is null or p_other_user_id = v_user then
    raise exception 'Invalid user to block';
  end if;
  if p_blocked is null then raise exception 'Block state is required'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_other_user_id) then
    raise exception 'User profile not found';
  end if;

  if p_blocked then
    insert into public.user_blocks(blocker_id, blocked_user_id)
    values (v_user, p_other_user_id)
    on conflict (blocker_id, blocked_user_id) do nothing;
  else
    delete from public.user_blocks
    where blocker_id = v_user
      and blocked_user_id = p_other_user_id;
  end if;

  return query
  select
    exists (
      select 1 from public.user_blocks b
      where b.blocker_id = v_user and b.blocked_user_id = p_other_user_id
    ),
    exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = v_user and b.blocked_user_id = p_other_user_id)
         or (b.blocker_id = p_other_user_id and b.blocked_user_id = v_user)
    );
end;
$$;

revoke all on function public.set_my_chat_block(uuid, boolean) from public, anon;
grant execute on function public.set_my_chat_block(uuid, boolean) to authenticated;

create or replace function public.get_my_chat_block_state(p_other_user_id uuid)
returns table(blocked_by_me boolean, messaging_unavailable boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_other_user_id is null or p_other_user_id = v_user then
    raise exception 'Invalid user';
  end if;

  return query
  select
    exists (
      select 1 from public.user_blocks b
      where b.blocker_id = v_user and b.blocked_user_id = p_other_user_id
    ),
    exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = v_user and b.blocked_user_id = p_other_user_id)
         or (b.blocker_id = p_other_user_id and b.blocked_user_id = v_user)
    );
end;
$$;

revoke all on function public.get_my_chat_block_state(uuid) from public, anon;
grant execute on function public.get_my_chat_block_state(uuid) to authenticated;

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
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_current_user and b.blocked_user_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_user_id = v_current_user)
  ) then
    raise exception 'Messaging is unavailable for this user';
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

revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

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
  v_other_user uuid;
  v_message public.messages;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_client_message_id is null then raise exception 'Message request id is required'; end if;
  if p_kind not in ('text', 'image', 'file', 'revision') then raise exception 'Invalid message kind'; end if;

  select case when c.participant_low = v_user then c.participant_high else c.participant_low end
    into v_other_user
  from public.conversations c
  where c.id = p_conversation_id
    and c.participant_low is not null
    and c.participant_high is not null
    and c.participant_low <> c.participant_high
    and v_user in (c.participant_low, c.participant_high)
    and (select count(*) from public.conversation_participants cp where cp.conversation_id = c.id) = 2
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = v_user
        and cp.hidden_at is null
    )
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = case when v_user = c.participant_low then c.participant_high else c.participant_low end
    );
  if v_other_user is null then
    raise exception 'Not an active participant in a valid 1-to-1 conversation';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_user and b.blocked_user_id = v_other_user)
       or (b.blocker_id = v_other_user and b.blocked_user_id = v_user)
  ) then
    raise exception 'Messaging is unavailable for this user';
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

revoke all on function public.send_message(uuid, uuid, text, text, text, integer, text, text, text) from public, anon;
grant execute on function public.send_message(uuid, uuid, text, text, text, integer, text, text, text) to authenticated;
