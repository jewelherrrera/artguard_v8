-- ArtGuard Hub
-- Supabase/Postgres schema for real multi-user accounts, profiles,
-- persistent 1:1 conversations, messages, read state, and last-seen presence.
--
-- Run this whole file once in Supabase SQL Editor.
-- Then add the `messages`, `conversation_participants`, and `profiles` tables
-- to the supabase_realtime publication (included at the bottom).

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text not null unique,
  role text not null check (role in ('artist', 'client')),
  bio text,
  interests text[] not null default '{}',
  avatar_data_url text,
  onboarded boolean not null default false,
  is_pro boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'image', 'file', 'revision')),
  text text,
  image_name text,
  image_variant integer check (image_variant between 1 and 6),
  file_name text,
  file_type text,
  file_size text,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read')),
  reaction text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants(user_id);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

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
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.get_or_create_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_user uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_current_user is null then
    raise exception 'Not authenticated';
  end if;

  if p_other_user_id = v_current_user then
    raise exception 'Cannot message yourself';
  end if;

  select cp.conversation_id
    into v_conversation_id
  from public.conversation_participants cp
  where cp.user_id = v_current_user
    and exists (
      select 1
      from public.conversation_participants cp2
      where cp2.conversation_id = cp.conversation_id
        and cp2.user_id = p_other_user_id
    )
  group by cp.conversation_id
  having count(*) = 2
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations default values returning id into v_conversation_id;
    insert into public.conversation_participants(conversation_id, user_id)
    values (v_conversation_id, v_current_user), (v_conversation_id, p_other_user_id);
  end if;

  return v_conversation_id;
end;
$$;

grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "authenticated users can read profiles" on public.profiles;
create policy "authenticated users can read profiles"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "participants can read conversations" on public.conversations;
create policy "participants can read conversations"
on public.conversations for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id
      and cp.user_id = auth.uid()
  )
);

drop policy if exists "participants can update conversations" on public.conversations;
create policy "participants can update conversations"
on public.conversations for update
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id
      and cp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id
      and cp.user_id = auth.uid()
  )
);

drop policy if exists "participants can read participant rows" on public.conversation_participants;
create policy "participants can read participant rows"
on public.conversation_participants for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants me
    where me.conversation_id = conversation_participants.conversation_id
      and me.user_id = auth.uid()
  )
);

drop policy if exists "users can add themselves to conversations" on public.conversation_participants;
create policy "users can add themselves to conversations"
on public.conversation_participants for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "participants can read messages" on public.messages;
create policy "participants can read messages"
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
      and cp.user_id = auth.uid()
  )
);

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
      and cp.user_id = auth.uid()
  )
);

drop policy if exists "participants can update messages" on public.messages;
create policy "participants can update messages"
on public.messages for update
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
      and cp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
      and cp.user_id = auth.uid()
  )
);

grant select, update on public.profiles to authenticated;
grant select, update on public.conversations to authenticated;
grant select, insert on public.conversation_participants to authenticated;
grant select, insert, update on public.messages to authenticated;

-- Realtime for new messages and live presence/last-seen.
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then
    null;
  end;
end $$;
