-- ArtGuard Hub: participant-scoped chat reset history
-- Run after chat-stabilization.sql and chat-auth-runtime-fix.sql.

alter table public.conversation_participants
  add column if not exists reset_at timestamptz;

-- Existing hidden rows came from the previous delete-as-hide behavior. Treat
-- their hide timestamp as the history boundary so reopening starts blank.
update public.conversation_participants
set reset_at = hidden_at
where hidden_at is not null
  and reset_at is null;

drop policy if exists "participants can read messages" on public.messages;
create policy "participants can read messages"
on public.messages for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
      and cp.user_id = auth.uid()
      and cp.hidden_at is null
      and (cp.reset_at is null or messages.created_at > cp.reset_at)
  )
);

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

  -- Reopen only the caller's list entry. Never clear their reset boundary.
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

drop function if exists public.hide_conversation(uuid);
create function public.hide_conversation(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reset_at timestamptz := now();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  update public.conversation_participants cp
  set hidden_at = v_reset_at,
      reset_at = v_reset_at
  where cp.conversation_id = p_conversation_id
    and cp.user_id = v_user;
  if not found then raise exception 'Not authorized for this conversation'; end if;

  return v_reset_at;
end;
$$;

revoke all on function public.hide_conversation(uuid) from public;
grant execute on function public.hide_conversation(uuid) to authenticated;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reset_at timestamptz;
  v_ids uuid[];
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select cp.reset_at into v_reset_at
  from public.conversation_participants cp
  where cp.conversation_id = p_conversation_id
    and cp.user_id = v_user
    and cp.hidden_at is null;
  if not found then raise exception 'Not authorized for this conversation'; end if;

  select coalesce(array_agg(m.id), '{}') into v_ids
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> v_user
    and m.status <> 'read'
    and (v_reset_at is null or m.created_at > v_reset_at);

  update public.messages m
  set status = 'read'
  where m.id = any(v_ids);

  return v_ids;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;