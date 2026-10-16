-- ArtGuard Hub: foundation for public, unassigned commission requests.
-- Depends on schema.sql for profiles and set_updated_at().
-- This workflow is separate from assigned commissions and does not modify commissions.

create table if not exists public.commission_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  budget_min numeric(12, 2),
  budget_max numeric(12, 2),
  currency text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_posts_title_not_blank check (length(btrim(title)) > 0),
  constraint commission_posts_description_not_blank check (length(btrim(description)) > 0),
  constraint commission_posts_budget_min_positive check (budget_min is null or budget_min > 0),
  constraint commission_posts_budget_max_positive check (budget_max is null or budget_max > 0),
  constraint commission_posts_budget_range_valid check (
    budget_min is null or budget_max is null or budget_min <= budget_max
  ),
  constraint commission_posts_currency_valid check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  constraint commission_posts_status_valid check (status in ('OPEN', 'CLOSED', 'SELECTED', 'CANCELLED'))
);

create index if not exists commission_posts_client_created_idx
  on public.commission_posts(client_id, created_at desc);
create index if not exists commission_posts_open_created_idx
  on public.commission_posts(status, created_at desc);

create table if not exists public.commission_post_applications (
  id uuid primary key default gen_random_uuid(),
  commission_post_id uuid not null references public.commission_posts(id) on delete cascade,
  artist_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_post_applications_message_not_blank check (length(btrim(message)) > 0),
  constraint commission_post_applications_status_valid check (status in ('PENDING', 'WITHDRAWN', 'SELECTED', 'REJECTED')),
  constraint commission_post_applications_post_artist_unique unique (commission_post_id, artist_id)
);

create index if not exists commission_post_applications_artist_created_idx
  on public.commission_post_applications(artist_id, created_at desc);
create index if not exists commission_post_applications_post_created_idx
  on public.commission_post_applications(commission_post_id, created_at desc);

alter table public.commission_posts enable row level security;
alter table public.commission_post_applications enable row level security;

revoke all on table public.commission_posts from public, anon, authenticated;
revoke all on table public.commission_post_applications from public, anon, authenticated;
grant select on table public.commission_posts to authenticated;
grant select on table public.commission_post_applications to authenticated;

drop policy if exists "clients and artists can read eligible commission posts" on public.commission_posts;
create policy "clients and artists can read eligible commission posts"
on public.commission_posts for select
to authenticated
using (
  client_id = auth.uid()
  or (
    status = 'OPEN'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'artist'
    )
  )
);

drop policy if exists "post owners and applicants can read applications" on public.commission_post_applications;
create policy "post owners and applicants can read applications"
on public.commission_post_applications for select
to authenticated
using (
  artist_id = auth.uid()
  or exists (
    select 1 from public.commission_posts p
    where p.id = commission_post_applications.commission_post_id
      and p.client_id = auth.uid()
  )
);

-- Keep timestamps consistent with the existing public.set_updated_at() trigger convention.
drop trigger if exists commission_posts_set_updated_at on public.commission_posts;
create trigger commission_posts_set_updated_at
before update on public.commission_posts
for each row execute function public.set_updated_at();

drop trigger if exists commission_post_applications_set_updated_at on public.commission_post_applications;
create trigger commission_post_applications_set_updated_at
before update on public.commission_post_applications
for each row execute function public.set_updated_at();

create or replace function public.create_commission_post(
  p_title text,
  p_description text,
  p_budget_min numeric,
  p_budget_max numeric,
  p_currency text
)
returns public.commission_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_currency text := p_currency;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'client' then raise exception 'Only client accounts can create commission posts'; end if;
  if v_title is null then raise exception 'Commission post title is required'; end if;
  if v_description is null then raise exception 'Commission post description is required'; end if;
  if p_budget_min is not null and p_budget_min <= 0 then raise exception 'Minimum budget must be greater than zero'; end if;
  if p_budget_max is not null and p_budget_max <= 0 then raise exception 'Maximum budget must be greater than zero'; end if;
  if p_budget_min is not null and p_budget_max is not null and p_budget_min > p_budget_max then
    raise exception 'Minimum budget cannot exceed maximum budget';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter uppercase code';
  end if;

  insert into public.commission_posts (
    client_id, title, description, budget_min, budget_max, currency, status
  )
  values (
    v_user, v_title, v_description, p_budget_min, p_budget_max, v_currency, 'OPEN'
  )
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.create_commission_post(text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.create_commission_post(text, text, numeric, numeric, text) to authenticated;

create or replace function public.list_my_commission_posts()
returns setof public.commission_posts
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'client' then raise exception 'Only client accounts can list their commission posts'; end if;

  return query
  select p.*
  from public.commission_posts p
  where p.client_id = v_user
  order by p.created_at desc;
end;
$$;

revoke all on function public.list_my_commission_posts() from public, anon, authenticated;
grant execute on function public.list_my_commission_posts() to authenticated;

create or replace function public.list_open_commission_posts()
returns table (
  id uuid,
  client_id uuid,
  title text,
  description text,
  budget_min numeric,
  budget_max numeric,
  currency text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'artist' then raise exception 'Only artist accounts can browse commission posts'; end if;

  return query
  select p.id, p.client_id, p.title, p.description, p.budget_min, p.budget_max,
         p.currency, p.created_at, p.updated_at
  from public.commission_posts p
  where p.status = 'OPEN'
  order by p.created_at desc;
end;
$$;

revoke all on function public.list_open_commission_posts() from public, anon, authenticated;
grant execute on function public.list_open_commission_posts() to authenticated;

create or replace function public.create_commission_post_application(
  p_commission_post_id uuid,
  p_message text
)
returns public.commission_post_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
  v_message text := nullif(btrim(p_message), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'artist' then raise exception 'Only artist accounts can apply to commission posts'; end if;
  if v_message is null then raise exception 'Application message is required'; end if;

  -- Serialize application creation against client cancellation/closure.
  select * into v_post
  from public.commission_posts
  where id = p_commission_post_id
  for update;
  if not found then raise exception 'Commission post not found'; end if;
  if v_post.status <> 'OPEN' then raise exception 'Commission post is not open'; end if;
  if v_post.client_id = v_user then raise exception 'Artists cannot apply to their own commission post'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user and p.role = 'artist'
  ) then
    raise exception 'Artist profile not found';
  end if;
  if exists (
    select 1 from public.commission_post_applications a
    where a.commission_post_id = v_post.id
      and a.artist_id = v_user
  ) then
    raise exception 'You have already applied to this commission post';
  end if;

  begin
    insert into public.commission_post_applications (
      commission_post_id, artist_id, message, status
    )
    values (v_post.id, v_user, v_message, 'PENDING')
    returning * into v_application;
  exception when unique_violation then
    raise exception 'You have already applied to this commission post';
  end;

  return v_application;
end;
$$;

revoke all on function public.create_commission_post_application(uuid, text) from public, anon, authenticated;
grant execute on function public.create_commission_post_application(uuid, text) to authenticated;

create or replace function public.list_my_commission_post_applications()
returns setof public.commission_post_applications
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'artist' then raise exception 'Only artist accounts can list their applications'; end if;

  return query
  select a.*
  from public.commission_post_applications a
  where a.artist_id = v_user
  order by a.created_at desc;
end;
$$;

revoke all on function public.list_my_commission_post_applications() from public, anon, authenticated;
grant execute on function public.list_my_commission_post_applications() to authenticated;

create or replace function public.list_post_applications_for_owner(p_commission_post_id uuid)
returns table (
  application_id uuid,
  commission_post_id uuid,
  artist_id uuid,
  message text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  artist_name text,
  artist_username text,
  artist_avatar_data_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'client' then raise exception 'Only client accounts can view post applications'; end if;

  select * into v_post
  from public.commission_posts p
  where p.id = p_commission_post_id
  for share;
  if not found then raise exception 'Commission post not found'; end if;
  if v_post.client_id <> v_user then raise exception 'Not authorized to view these applications'; end if;

  return query
  select a.id, a.commission_post_id, a.artist_id, a.message, a.status,
         a.created_at, a.updated_at, artist.name, artist.username, artist.avatar_data_url
  from public.commission_post_applications a
  join public.profiles artist on artist.id = a.artist_id and artist.role = 'artist'
  where a.commission_post_id = v_post.id
  order by a.created_at desc;
end;
$$;

revoke all on function public.list_post_applications_for_owner(uuid) from public, anon, authenticated;
grant execute on function public.list_post_applications_for_owner(uuid) to authenticated;

create or replace function public.withdraw_commission_post_application(p_application_id uuid)
returns public.commission_post_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_application public.commission_post_applications;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'artist' then raise exception 'Only artist accounts can withdraw applications'; end if;

  select * into v_application
  from public.commission_post_applications
  where id = p_application_id
  for update;
  if not found then raise exception 'Application not found'; end if;
  if v_application.artist_id <> v_user then raise exception 'Not authorized to withdraw this application'; end if;
  if v_application.status <> 'PENDING' then raise exception 'Only pending applications can be withdrawn'; end if;

  update public.commission_post_applications
  set status = 'WITHDRAWN'
  where id = v_application.id
    and artist_id = v_user
    and status = 'PENDING'
  returning * into v_application;
  if not found then raise exception 'Only pending applications can be withdrawn'; end if;

  return v_application;
end;
$$;

revoke all on function public.withdraw_commission_post_application(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_commission_post_application(uuid) to authenticated;

create or replace function public.update_commission_post(
  p_commission_post_id uuid,
  p_title text,
  p_description text,
  p_budget_min numeric,
  p_budget_max numeric,
  p_currency text
)
returns public.commission_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'client' then raise exception 'Only client accounts can update commission posts'; end if;

  select * into v_post
  from public.commission_posts
  where id = p_commission_post_id
  for update;
  if not found then raise exception 'Commission post not found'; end if;
  if v_post.client_id <> v_user then raise exception 'Not authorized to update this commission post'; end if;
  if v_post.status <> 'OPEN' then raise exception 'Only open commission posts can be updated'; end if;
  if v_title is null then raise exception 'Commission post title is required'; end if;
  if v_description is null then raise exception 'Commission post description is required'; end if;
  if p_budget_min is not null and p_budget_min <= 0 then raise exception 'Minimum budget must be greater than zero'; end if;
  if p_budget_max is not null and p_budget_max <= 0 then raise exception 'Maximum budget must be greater than zero'; end if;
  if p_budget_min is not null and p_budget_max is not null and p_budget_min > p_budget_max then
    raise exception 'Minimum budget cannot exceed maximum budget';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter uppercase code';
  end if;

  update public.commission_posts
  set title = v_title,
      description = v_description,
      budget_min = p_budget_min,
      budget_max = p_budget_max,
      currency = p_currency
  where id = v_post.id
    and client_id = v_user
    and status = 'OPEN'
  returning * into v_post;
  if not found then raise exception 'Only open commission posts can be updated'; end if;

  return v_post;
end;
$$;

revoke all on function public.update_commission_post(uuid, text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.update_commission_post(uuid, text, text, numeric, numeric, text) to authenticated;

create or replace function public.close_commission_post(p_commission_post_id uuid)
returns public.commission_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is distinct from 'client' then raise exception 'Only client accounts can cancel commission posts'; end if;

  -- Serialize post cancellation against application creation.
  select * into v_post
  from public.commission_posts
  where id = p_commission_post_id
  for update;
  if not found then raise exception 'Commission post not found'; end if;
  if v_post.client_id <> v_user then raise exception 'Not authorized to cancel this commission post'; end if;
  if v_post.status <> 'OPEN' then raise exception 'Only open commission posts can be cancelled'; end if;

  update public.commission_posts
  set status = 'CANCELLED'
  where id = v_post.id
    and client_id = v_user
    and status = 'OPEN'
  returning * into v_post;
  if not found then raise exception 'Only open commission posts can be cancelled'; end if;

  return v_post;
end;
$$;

revoke all on function public.close_commission_post(uuid) from public, anon, authenticated;
grant execute on function public.close_commission_post(uuid) to authenticated;
