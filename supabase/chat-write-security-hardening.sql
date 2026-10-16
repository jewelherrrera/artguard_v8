-- ArtGuard Hub: prevent direct client writes to chat messages.
-- Run after chat-stabilization.sql and chat-reset-history.sql.
-- Message creation and supported updates remain available through authorized RPCs.

revoke insert, update, delete, truncate on table public.messages
  from public, anon, authenticated;

-- The application uses SECURITY DEFINER RPCs for all supported message writes.
-- Remove the earlier direct-write policies; retain participant-scoped SELECT.
drop policy if exists "participants can send messages" on public.messages;
drop policy if exists "participants can update messages" on public.messages;
drop policy if exists "participants can delete messages" on public.messages;

-- Keep the existing application RPC as the only message creation path.
-- Legacy conversations without a canonical, exact two-person membership are
-- intentionally not eligible for new sends.
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
    select 1
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
      )
  ) then
    raise exception 'Not an active participant in a valid 1-to-1 conversation';
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
