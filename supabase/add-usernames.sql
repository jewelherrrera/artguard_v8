-- Run this ONCE after the original schema.sql if your profiles table already exists.
-- It adds @username values based on each user's email local-part, e.g.
-- jewel.herrera@gmail.com -> @jewel.herrera

alter table public.profiles
add column if not exists username text;

update public.profiles p
set username = lower(regexp_replace(split_part(u.email, '@', 1), '[^a-zA-Z0-9._-]+', '', 'g'))
from auth.users u
where p.id = u.id
  and (p.username is null or p.username = '');

update public.profiles
set username = 'user_' || substr(id::text, 1, 8)
where username is null or username = '';

create unique index if not exists profiles_username_unique_idx
on public.profiles(username);

alter table public.profiles
alter column username set not null;

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
    set username = excluded.username;
  return new;
end;
$$;
