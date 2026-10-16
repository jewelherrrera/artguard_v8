-- Run this once if profiles is empty or new signups cannot create a profile.
-- It is safe to re-run.
alter table public.profiles enable row level security;

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

insert into public.profiles (id, name, role, onboarded)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'role', 'client'),
  coalesce((u.raw_user_meta_data->>'onboarded')::boolean, false)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
