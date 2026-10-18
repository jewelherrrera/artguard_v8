-- Apply after chat-attachments-and-artwork-sharing.sql and its prerequisites.
-- A deleted participant gets a fresh conversation on the next send; old
-- messages remain attached to the deleted conversation and stay hidden there.

alter table public.conversation_participants
  add column if not exists deleted_at timestamptz;

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

-- Before this migration, reset_at was set by conversation deletion. The
-- previous unhide trigger could later clear hidden_at, so preserve reset_at as
-- the durable evidence that the participant had deleted that thread.
update public.conversation_participants
set deleted_at = coalesce(hidden_at, reset_at),
    hidden_at = coalesce(hidden_at, reset_at)
where deleted_at is null
  and (hidden_at is not null or reset_at is not null);

-- A participant pair can now have multiple historical conversation threads.
drop index if exists public.conversations_participant_pair_unique_idx;

-- Remove the prior behavior that reopened the recipient's deleted thread.
drop trigger if exists messages_unhide_recipient_after_insert on public.messages;
drop function if exists public.unhide_chat_recipient_after_message();

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
    and exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = v_low
        and cp.deleted_at is null
    )
    and exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = v_high
        and cp.deleted_at is null
    )
  order by c.updated_at desc, c.created_at desc, c.id desc
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations(participant_low, participant_high)
    values (v_low, v_high)
    returning id into v_conversation_id;

    insert into public.conversation_participants(conversation_id, user_id)
    values (v_conversation_id, v_low), (v_conversation_id, v_high);
  end if;

  -- A caller may reopen a temporarily hidden thread, but deleted rows never
  -- qualify above and their reset/deletion boundaries are never changed.
  update public.conversation_participants
  set hidden_at = null
  where conversation_id = v_conversation_id
    and user_id = p_user_id
    and deleted_at is null
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

create or replace function public.resolve_conversation_for_send(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_other_user uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select case
    when c.participant_low = v_user then c.participant_high
    else c.participant_low
  end
  into v_other_user
  from public.conversations c
  where c.id = p_conversation_id
    and c.participant_low is not null
    and c.participant_high is not null
    and c.participant_low <> c.participant_high
    and v_user in (c.participant_low, c.participant_high)
    and (select count(*) from public.conversation_participants cp
         where cp.conversation_id = c.id) = 2
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = v_user
    );
  if v_other_user is null then
    raise exception 'Not a participant in a valid 1-to-1 conversation';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_user and b.blocked_user_id = v_other_user)
       or (b.blocker_id = v_other_user and b.blocked_user_id = v_user)
  ) then
    raise exception 'Messaging is unavailable for this user';
  end if;

  return public.get_or_create_active_chat_conversation(v_user, v_other_user);
end;
$$;

revoke all on function public.resolve_conversation_for_send(uuid) from public, anon;
grant execute on function public.resolve_conversation_for_send(uuid) to authenticated;

create or replace function public.hide_conversation(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_deleted_at timestamptz := now();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  update public.conversation_participants
  set hidden_at = v_deleted_at,
      reset_at = v_deleted_at,
      deleted_at = v_deleted_at
  where conversation_id = p_conversation_id
    and user_id = v_user;
  if not found then raise exception 'Not authorized for this conversation'; end if;

  return v_deleted_at;
end;
$$;

revoke all on function public.hide_conversation(uuid) from public, anon;
grant execute on function public.hide_conversation(uuid) to authenticated;

create or replace function public.send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_kind text default 'text',
  p_text text default null,
  p_image_name text default null,
  p_image_variant integer default null,
  p_file_name text default null,
  p_file_type text default null,
  p_file_size text default null,
  p_attachment_storage_path text default null,
  p_attachment_mime_type text default null,
  p_attachment_size_bytes bigint default null,
  p_artwork_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_other_user uuid;
  v_target_conversation_id uuid;
  v_low uuid;
  v_high uuid;
  v_existing_low uuid;
  v_existing_high uuid;
  v_message public.messages;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_client_message_id is null then raise exception 'Message request id is required'; end if;
  if p_kind not in ('text', 'image', 'file', 'artwork', 'revision') then
    raise exception 'Invalid message kind';
  end if;

  select c.participant_low, c.participant_high
  into v_low, v_high
  from public.conversations c
  where c.id = p_conversation_id
    and c.participant_low is not null
    and c.participant_high is not null
    and c.participant_low <> c.participant_high
    and v_user in (c.participant_low, c.participant_high)
    and (select count(*) from public.conversation_participants cp
         where cp.conversation_id = c.id) = 2
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = v_user
    )
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id
        and cp.user_id = case when v_user = c.participant_low
                              then c.participant_high else c.participant_low end
    );
  if v_low is null or v_high is null then
    raise exception 'Not a participant in a valid 1-to-1 conversation';
  end if;
  v_other_user := case when v_user = v_low then v_high else v_low end;

  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_user and b.blocked_user_id = v_other_user)
       or (b.blocker_id = v_other_user and b.blocked_user_id = v_user)
  ) then
    raise exception 'Messaging is unavailable for this user';
  end if;

  -- A retried request returns its original message only for this participant
  -- pair; the client request ID cannot be replayed into another conversation.
  select m.* into v_message
  from public.messages m
  where m.sender_id = v_user
    and m.client_message_id = p_client_message_id;
  if v_message.id is not null then
    select c.participant_low, c.participant_high
    into v_existing_low, v_existing_high
    from public.conversations c
    where c.id = v_message.conversation_id;
    if v_existing_low is distinct from v_low or v_existing_high is distinct from v_high then
      raise exception 'Message request ID was already used for another conversation';
    end if;
    return v_message;
  end if;

  v_target_conversation_id :=
    public.get_or_create_active_chat_conversation(v_user, v_other_user);

  if p_kind in ('image', 'file') then
    if p_artwork_id is not null
      or p_attachment_storage_path is null
      or p_attachment_mime_type is null
      or p_attachment_size_bytes is null
      or p_file_name is null
      or length(p_file_name) < 1
      or length(p_file_name) > 180 then
      raise exception 'Attachment metadata is incomplete';
    end if;
    if p_file_name ~ '[[:cntrl:]]'
      or position('/' in p_file_name) > 0
      or position(chr(92) in p_file_name) > 0
      or p_file_type is null
      or p_file_type !~ '^[A-Z0-9]{1,12}$'
      or p_file_size is null
      or length(p_file_size) > 20 then
      raise exception 'Attachment filename or display metadata is invalid';
    end if;
    if p_attachment_storage_path !~ (
      '^' || v_target_conversation_id::text || '/' || v_user::text || '/'
      || p_client_message_id::text || '\.[a-zA-Z0-9]{1,10}$'
    ) then
      raise exception 'Attachment storage path does not match the active conversation';
    end if;
    if not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'chat-attachments'
        and o.name = p_attachment_storage_path
        and o.metadata ->> 'mimetype' = p_attachment_mime_type
        and coalesce(
          (o.metadata ->> 'size')::bigint,
          (o.metadata ->> 'contentLength')::bigint
        ) = p_attachment_size_bytes
    ) then
      raise exception 'The uploaded file does not match its stored attachment metadata';
    end if;
    if p_kind = 'image' then
      if p_attachment_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
        or p_attachment_size_bytes < 1 or p_attachment_size_bytes > 15728640 then
        raise exception 'Images must be a supported format and 15 MB or smaller';
      end if;
    else
      if p_attachment_mime_type not in (
        'application/pdf', 'text/plain', 'text/rtf', 'application/rtf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/zip'
      ) or p_attachment_size_bytes < 1 or p_attachment_size_bytes > 20971520 then
        raise exception 'This file type or size is not allowed';
      end if;
    end if;
  elsif p_kind = 'artwork' then
    if p_artwork_id is null
      or p_attachment_storage_path is not null
      or p_attachment_mime_type is not null
      or p_attachment_size_bytes is not null then
      raise exception 'Artwork message metadata is invalid';
    end if;
    if not exists (
      select 1 from public.artworks a
      where a.id = p_artwork_id
        and a.owner_id = v_user
        and a.status = 'ready'
        and a.protected_storage_path is not null
        and a.visibility in ('portfolio', 'discover')
    ) then
      raise exception 'Only ready, published protected artwork can be shared';
    end if;
  elsif p_attachment_storage_path is not null
    or p_attachment_mime_type is not null
    or p_attachment_size_bytes is not null
    or p_artwork_id is not null then
    raise exception 'Unexpected attachment metadata';
  end if;

  insert into public.messages(
    conversation_id, sender_id, client_message_id, kind, text,
    image_name, image_variant, file_name, file_type, file_size,
    attachment_storage_path, attachment_mime_type, attachment_size_bytes,
    artwork_id, status
  ) values (
    v_target_conversation_id, v_user, p_client_message_id, p_kind, p_text,
    p_image_name, p_image_variant, p_file_name, p_file_type, p_file_size,
    p_attachment_storage_path, p_attachment_mime_type, p_attachment_size_bytes,
    p_artwork_id, 'sent'
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
    select c.participant_low, c.participant_high
    into v_existing_low, v_existing_high
    from public.conversations c
    where c.id = v_message.conversation_id;
    if v_existing_low is distinct from v_low or v_existing_high is distinct from v_high then
      raise exception 'Message request ID was already used for another conversation';
    end if;
    return v_message;
  end if;

  update public.conversations c
  set updated_at = now()
  where c.id = v_target_conversation_id;

  return v_message;
end;
$$;

revoke all on function public.send_message(
  uuid, uuid, text, text, text, integer, text, text, text, text, text, bigint, uuid
) from public, anon;
grant execute on function public.send_message(
  uuid, uuid, text, text, text, integer, text, text, text, text, text, bigint, uuid
) to authenticated;
