-- ArtGuard Hub: private chat attachments and protected artwork message cards.
-- Apply manually after chat-mute-and-block.sql and artwork-publication.sql.
-- No existing messages or artwork publication settings are changed.

alter table public.messages
  add column if not exists attachment_storage_path text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size_bytes bigint,
  add column if not exists artwork_id uuid references public.artworks(id) on delete set null;

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text', 'image', 'file', 'artwork', 'revision'));

create index if not exists messages_artwork_id_idx
  on public.messages(artwork_id)
  where artwork_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/rtf', 'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_upload_chat_attachment(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_participants cp
      on cp.conversation_id = c.id
     and cp.user_id = auth.uid()
     and cp.hidden_at is null
    where c.id::text = p_conversation_id
      and auth.uid() in (c.participant_low, c.participant_high)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_user_id = case
          when c.participant_low = auth.uid() then c.participant_high else c.participant_low end)
           or (b.blocker_id = case
          when c.participant_low = auth.uid() then c.participant_high else c.participant_low end
          and b.blocked_user_id = auth.uid())
      )
  );
$$;

revoke all on function public.can_upload_chat_attachment(text) from public, anon;
grant execute on function public.can_upload_chat_attachment(text) to authenticated;

drop policy if exists "chat participants can upload their own attachments" on storage.objects;
create policy "chat participants can upload their own attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = auth.uid()::text
  and name ~ (
    '^' || (storage.foldername(name))[1] || '/' || auth.uid()::text
    || '/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]{1,10}$'
  )
  and public.can_upload_chat_attachment((storage.foldername(name))[1])
);

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
    where m.attachment_storage_path = storage.objects.name
      and m.conversation_id::text = (storage.foldername(storage.objects.name))[1]
      and cp.user_id = auth.uid()
  )
);

drop policy if exists "senders can remove orphaned chat attachments" on storage.objects;
create policy "senders can remove orphaned chat attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id::text = (storage.foldername(name))[1]
      and cp.user_id = auth.uid()
  )
  and not exists (
    select 1 from public.messages m
    where m.attachment_storage_path = storage.objects.name
  )
);

drop function if exists public.send_message(uuid, uuid, text, text, text, integer, text, text, text);

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
  v_message public.messages;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_client_message_id is null then raise exception 'Message request id is required'; end if;
  if p_kind not in ('text', 'image', 'file', 'artwork', 'revision') then
    raise exception 'Invalid message kind';
  end if;

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
      '^' || p_conversation_id::text || '/' || v_user::text || '/'
      || p_client_message_id::text || '\.[a-zA-Z0-9]{1,10}$'
    ) then
      raise exception 'Attachment storage path is invalid';
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
    p_conversation_id, v_user, p_client_message_id, p_kind, p_text,
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

revoke all on function public.send_message(uuid, uuid, text, text, text, integer, text, text, text, text, text, bigint, uuid)
  from public, anon;
grant execute on function public.send_message(uuid, uuid, text, text, text, integer, text, text, text, text, text, bigint, uuid)
  to authenticated;

create or replace function public.get_chat_shared_artwork_preview(
  p_conversation_id uuid,
  p_message_id uuid
)
returns table (
  artwork_id uuid,
  title text,
  owner_id uuid,
  protected_storage_path text,
  dynamic_cloaking boolean,
  canvas_tiling boolean,
  right_click_shield boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  return query
  select
    a.id,
    a.title,
    a.owner_id,
    a.protected_storage_path,
    coalesce(s.dynamic_cloaking, false),
    coalesce(s.canvas_tiling, false),
    coalesce(s.right_click_shield, false)
  from public.messages m
  join public.conversation_participants cp
    on cp.conversation_id = m.conversation_id
   and cp.user_id = v_user
  join public.artworks a
    on a.id = m.artwork_id
   and a.owner_id = m.sender_id
  left join public.artwork_protection_settings s
    on s.artwork_id = a.id
   and s.owner_id = a.owner_id
  where m.id = p_message_id
    and m.conversation_id = p_conversation_id
    and m.kind = 'artwork'
    and a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility in ('portfolio', 'discover');
end;
$$;

revoke all on function public.get_chat_shared_artwork_preview(uuid, uuid) from public, anon;
grant execute on function public.get_chat_shared_artwork_preview(uuid, uuid) to authenticated;
