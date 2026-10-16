-- ArtGuard Hub — production-style direct chat repair
-- Run this ONCE in Supabase SQL Editor on the existing project.
-- Safe to run repeatedly: functions/indexes are idempotent.

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) Profile fields / signup consistency
-- ------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists last_seen_at timestamptz;

update public.profiles p
set username = coalesce(
  nullif(lower(regexp_replace(split_part(u.email, '@', 1), '[^a-zA-Z0-9._-]+', '', 'g')), ''),
  'user_' || substr(p.id::text, 1, 8)
)
from auth.users u
where p.id = u.id
  and (p.username is null or p.username = '');

update public.profiles
set username = 'user_' || substr(id::text, 1, 8)
where username is null or username = '';

create unique index if not exists profiles_username_unique_idx
on public.profiles(username);

alter table public.profiles alter column username set not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(
      nullif(lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9._-]+', '', 'g')), ''),
      'user_' || substr(new.id::text, 1, 8)
    ),
    coalesce(new.raw_user_meta_data ->> 'role', 'client')
  )
  on conflict (id) do update
    set name = excluded.name,
        username = excluded.username,
        role = excluded.role;
  return new;
end;
$$;

-- Re-bind the trigger in case an old function/trigger was used.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- 2) Message fields used by the UI
-- ------------------------------------------------------------
alter table public.messages add column if not exists status text;
alter table public.messages add column if not exists reaction text;
update public.messages set status = 'sent' where status is null;
alter table public.messages alter column status set default 'sent';

-- ------------------------------------------------------------
-- 3) Remove duplicate 1-to-1 conversations that may have been created by
--    older versions. Keep the newest conversation for each exact participant pair,
--    move messages to it, then delete the duplicate conversation.
-- ------------------------------------------------------------
create temp table if not exists ag_chat_dedupe_map (
  duplicate_id uuid primary key,
  keeper_id uuid not null
) on commit drop;

truncate ag_chat_dedupe_map;

insert into ag_chat_dedupe_map (duplicate_id, keeper_id)
with pair_conversations as (
  select
    cp.conversation_id,
    array_agg(cp.user_id order by cp.user_id) as participant_pair,
    max(c.updated_at) as updated_at,
    max(c.created_at) as created_at
  from public.conversation_participants cp
  join public.conversations c on c.id = cp.conversation_id
  group by cp.conversation_id
  having count(*) = 2
), ranked as (
  select
    conversation_id,
    participant_pair,
    row_number() over (
      partition by participant_pair
      order by updated_at desc nulls last, created_at desc nulls last, conversation_id desc
    ) as rn
  from pair_conversations
)
select r.conversation_id, k.conversation_id
from ranked r
join ranked k
  on k.participant_pair = r.participant_pair
 and k.rn = 1
where r.rn > 1;

update public.messages m
set conversation_id = d.keeper_id
from ag_chat_dedupe_map d
where m.conversation_id = d.duplicate_id;

update public.conversations c
set updated_at = greatest(c.updated_at, coalesce((
  select max(m.created_at) from public.messages m where m.conversation_id = c.id
), c.updated_at))
where c.id in (select keeper_id from ag_chat_dedupe_map);

delete from public.conversations c
where c.id in (select duplicate_id from ag_chat_dedupe_map);

-- Advisory lock makes simultaneous clicks from two tabs wait on the same
-- participant pair, preventing another duplicate from being created.
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
  if v_current_user is null then
    raise exception 'Not authenticated';
  end if;

  if p_other_user_id is null or p_other_user_id = v_current_user then
    raise exception 'Invalid recipient';
  end if;

  v_low := least(v_current_user, p_other_user_id);
  v_high := greatest(v_current_user, p_other_user_id);
  v_lock_key := hashtextextended(v_low::text || ':' || v_high::text, 1937);
  perform pg_advisory_xact_lock(v_lock_key);

  select cp.conversation_id
    into v_conversation_id
  from public.conversation_participants cp
  join public.conversation_participants cp2
    on cp2.conversation_id = cp.conversation_id
   and cp2.user_id = p_other_user_id
  where cp.user_id = v_current_user
    and (
      select count(*)
      from public.conversation_participants all_cp
      where all_cp.conversation_id = cp.conversation_id
    ) = 2
  order by cp.conversation_id
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations default values
    returning id into v_conversation_id;

    insert into public.conversation_participants(conversation_id, user_id)
    values (v_conversation_id, v_current_user),
           (v_conversation_id, p_other_user_id);
  end if;

  return v_conversation_id;
end;
$$;

grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) Secure message sending and message delivery/read helpers
-- ------------------------------------------------------------
create or replace function public.send_message(
  p_conversation_id uuid,
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
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id = v_user
  ) then
    raise exception 'Not a participant in this conversation';
  end if;
  if p_kind not in ('text','image','file','revision') then
    raise exception 'Invalid message kind';
  end if;

  insert into public.messages(
    conversation_id, sender_id, kind, text,
    image_name, image_variant, file_name, file_type, file_size, status
  ) values (
    p_conversation_id, v_user, p_kind, p_text,
    p_image_name, p_image_variant, p_file_name, p_file_type, p_file_size, 'sent'
  )
  returning * into v_message;

  update public.conversations
  set updated_at = now()
  where id = p_conversation_id;

  return v_message;
end;
$$;

grant execute on function public.send_message(uuid, text, text, text, integer, text, text, text) to authenticated;

create or replace function public.mark_message_delivered(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.messages m
  set status = 'delivered'
  where m.id = p_message_id
    and m.sender_id <> auth.uid()
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
    )
    and m.status <> 'read';
end;
$$;

grant execute on function public.mark_message_delivered(uuid) to authenticated;

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
    where cp.conversation_id = p_conversation_id and cp.user_id = v_user
  ) then
    raise exception 'Not a participant in this conversation';
  end if;

  select coalesce(array_agg(m.id), '{}') into v_ids
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> v_user
    and m.status <> 'read';

  update public.messages
  set status = 'read'
  where id = any(v_ids);

  return v_ids;
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.update_message_reaction(
  p_message_id uuid,
  p_reaction text
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
  if not exists (
    select 1 from public.conversation_participants cp
    join public.messages m on m.conversation_id = cp.conversation_id
    where m.id = p_message_id and cp.user_id = v_user
  ) then
    raise exception 'Not a participant in this message';
  end if;

  update public.messages
  set reaction = nullif(p_reaction, '')
  where id = p_message_id
  returning * into v_message;

  return v_message;
end;
$$;

grant execute on function public.update_message_reaction(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5) Realtime publication
-- ------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversation_participants; exception when duplicate_object then null; end;
end $$;
