-- Role-symmetric public commission posts.
-- Run after the existing commission post foundation, comments, engagement,
-- delete, rejection, and selection migrations.
-- Legacy client_id/artist_id columns remain populated as compatibility aliases.

alter table public.commission_posts
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade,
  add column if not exists owner_role text;

update public.commission_posts
set owner_id = client_id,
    owner_role = 'client'
where owner_id is null or owner_role is null;

alter table public.commission_posts
  alter column owner_id set not null,
  alter column owner_role set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commission_posts_owner_role_valid'
      and conrelid = 'public.commission_posts'::regclass
  ) then
    alter table public.commission_posts
      add constraint commission_posts_owner_role_valid
      check (owner_role in ('client', 'artist'));
  end if;
end;
$$;

create index if not exists commission_posts_owner_created_idx
  on public.commission_posts(owner_id, created_at desc);

alter table public.commission_post_applications
  add column if not exists applicant_id uuid references public.profiles(id) on delete cascade,
  add column if not exists applicant_role text;

update public.commission_post_applications
set applicant_id = artist_id,
    applicant_role = 'artist'
where applicant_id is null or applicant_role is null;

alter table public.commission_post_applications
  alter column applicant_id set not null,
  alter column applicant_role set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commission_post_applications_applicant_role_valid'
      and conrelid = 'public.commission_post_applications'::regclass
  ) then
    alter table public.commission_post_applications
      add constraint commission_post_applications_applicant_role_valid
      check (applicant_role in ('client', 'artist'));
  end if;
end;
$$;

create unique index if not exists commission_post_applications_post_applicant_unique
  on public.commission_post_applications(commission_post_id, applicant_id);

alter table public.commission_posts enable row level security;
alter table public.commission_post_applications enable row level security;

revoke insert, update, delete, truncate on table public.commission_posts
  from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.commission_post_applications
  from public, anon, authenticated;
grant select on table public.commission_posts, public.commission_post_applications
  to authenticated;

drop policy if exists "clients and artists can read eligible commission posts"
  on public.commission_posts;
drop policy if exists "authenticated users can read visible commission posts"
  on public.commission_posts;
create policy "authenticated users can read visible commission posts"
on public.commission_posts for select
to authenticated
using (
  owner_id = auth.uid()
  or (
    status = 'OPEN'
    and exists (
      select 1 from public.profiles as profile
      where profile.id = auth.uid()
        and profile.role in ('client', 'artist')
    )
  )
);

drop policy if exists "post owners and applicants can read applications"
  on public.commission_post_applications;
drop policy if exists "owners and applicants can read eligible applications"
  on public.commission_post_applications;
create policy "owners and applicants can read eligible applications"
on public.commission_post_applications for select
to authenticated
using (
  applicant_id = auth.uid()
  or exists (
    select 1 from public.commission_posts as post
    where post.id = commission_post_applications.commission_post_id
      and post.owner_id = auth.uid()
      and post.owner_role <> commission_post_applications.applicant_role
  )
);

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
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;
  if v_title is null then raise exception 'POST_INVALID_TITLE'; end if;
  if v_description is null then raise exception 'POST_INVALID_DESCRIPTION'; end if;
  if p_budget_min is not null and (p_budget_min <= 0 or p_budget_min::text in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'POST_INVALID_BUDGET';
  end if;
  if p_budget_max is not null and (p_budget_max <= 0 or p_budget_max::text in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'POST_INVALID_BUDGET';
  end if;
  if p_budget_min is not null and p_budget_max is not null and p_budget_min > p_budget_max then
    raise exception 'POST_INVALID_BUDGET_RANGE';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'POST_INVALID_CURRENCY';
  end if;

  insert into public.commission_posts (
    client_id, owner_id, owner_role, title, description,
    budget_min, budget_max, currency, status
  )
  values (
    v_user, v_user, v_role, v_title, v_description,
    p_budget_min, p_budget_max, v_currency, 'OPEN'
  )
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.create_commission_post(text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.create_commission_post(text, text, numeric, numeric, text)
  to authenticated;

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
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  return query
  select post.*
  from public.commission_posts as post
  where post.owner_id = v_user
  order by post.created_at desc;
end;
$$;

revoke all on function public.list_my_commission_posts()
  from public, anon, authenticated;
grant execute on function public.list_my_commission_posts()
  to authenticated;

drop function if exists public.list_open_commission_posts();
create function public.list_open_commission_posts()
returns table (
  id uuid,
  client_id uuid,
  owner_id uuid,
  owner_role text,
  title text,
  description text,
  budget_min numeric,
  budget_max numeric,
  currency text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  owner_name text,
  owner_username text,
  owner_avatar_data_url text
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
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  return query
  select post.id, post.client_id, post.owner_id, post.owner_role,
         post.title, post.description, post.budget_min, post.budget_max,
         post.currency, post.status, post.created_at, post.updated_at,
         owner.name, owner.username, owner.avatar_data_url
  from public.commission_posts as post
  join public.profiles as owner on owner.id = post.owner_id
  where post.status = 'OPEN'
  order by post.created_at desc;
end;
$$;

revoke all on function public.list_open_commission_posts()
  from public, anon, authenticated;
grant execute on function public.list_open_commission_posts()
  to authenticated;

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
  v_name text;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
  v_message text := nullif(btrim(p_message), '');
begin
  if v_user is null then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  if v_message is null then raise exception 'APPLICATION_INVALID_MESSAGE'; end if;

  select profile.role, profile.name
  into v_role, v_name
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'APPLICATION_POST_NOT_FOUND'; end if;
  if v_post.status <> 'OPEN' then raise exception 'APPLICATION_POST_NOT_OPEN'; end if;
  if v_post.owner_id = v_user then raise exception 'APPLICATION_OWN_POST'; end if;
  if v_post.owner_role = v_role then
    raise exception 'APPLICATION_ROLE_NOT_ELIGIBLE';
  end if;

  begin
    insert into public.commission_post_applications (
      commission_post_id, artist_id, applicant_id, applicant_role,
      message, status
    )
    values (
      v_post.id, v_user, v_user, v_role, v_message, 'PENDING'
    )
    returning * into v_application;
  exception when unique_violation then
    raise exception 'APPLICATION_ALREADY_EXISTS';
  end;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_post.owner_id,
    'commission',
    'New Public Commission Request',
    coalesce(v_name, 'A user') || ' submitted a request for your post "' || v_post.title || '".',
    v_post.id,
    '/market'
  );

  return v_application;
end;
$$;

revoke all on function public.create_commission_post_application(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_commission_post_application(uuid, text)
  to authenticated;

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
  if v_user is null then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  return query
  select application.*
  from public.commission_post_applications as application
  where application.applicant_id = v_user
  order by application.created_at desc;
end;
$$;

revoke all on function public.list_my_commission_post_applications()
  from public, anon, authenticated;
grant execute on function public.list_my_commission_post_applications()
  to authenticated;

drop function if exists public.list_post_applications_for_owner(uuid);
create function public.list_post_applications_for_owner(p_commission_post_id uuid)
returns table (
  application_id uuid,
  commission_post_id uuid,
  artist_id uuid,
  applicant_id uuid,
  applicant_role text,
  message text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  applicant_name text,
  applicant_username text,
  applicant_avatar_data_url text
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
  if v_user is null then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id;
  if not found then raise exception 'APPLICATION_POST_NOT_FOUND'; end if;
  if v_post.owner_id <> v_user or v_post.owner_role <> v_role then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  return query
  select application.id, application.commission_post_id, application.artist_id,
         application.applicant_id, application.applicant_role,
         application.message, application.status, application.created_at,
         application.updated_at, applicant.name, applicant.username,
         applicant.avatar_data_url
  from public.commission_post_applications as application
  join public.profiles as applicant
    on applicant.id = application.applicant_id
   and applicant.role = application.applicant_role
  where application.commission_post_id = v_post.id
    and application.applicant_role <> v_post.owner_role
  order by application.created_at desc;
end;
$$;

revoke all on function public.list_post_applications_for_owner(uuid)
  from public, anon, authenticated;
grant execute on function public.list_post_applications_for_owner(uuid)
  to authenticated;

create or replace function public.withdraw_commission_post_application(
  p_application_id uuid
)
returns public.commission_post_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post_id uuid;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
begin
  if v_user is null then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  select application.commission_post_id into v_post_id
  from public.commission_post_applications as application
  where application.id = p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = v_post_id
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  select application.* into v_application
  from public.commission_post_applications as application
  where application.id = p_application_id
    and application.commission_post_id = v_post.id
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_application.applicant_id <> v_user
    or v_application.applicant_role <> v_role then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;
  if v_application.status <> 'PENDING' then
    raise exception 'APPLICATION_NOT_PENDING';
  end if;

  update public.commission_post_applications as application
  set status = 'WITHDRAWN'
  where application.id = v_application.id
    and application.applicant_id = v_user
    and application.status = 'PENDING'
  returning application.* into v_application;
  if not found then raise exception 'APPLICATION_NOT_PENDING'; end if;
  return v_application;
end;
$$;

revoke all on function public.withdraw_commission_post_application(uuid)
  from public, anon, authenticated;
grant execute on function public.withdraw_commission_post_application(uuid)
  to authenticated;

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
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if v_post.owner_id <> v_user or v_post.owner_role <> v_role then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;
  if v_post.status <> 'OPEN' then raise exception 'POST_NOT_OPEN'; end if;
  if v_title is null then raise exception 'POST_INVALID_TITLE'; end if;
  if v_description is null then raise exception 'POST_INVALID_DESCRIPTION'; end if;
  if p_budget_min is not null and (p_budget_min <= 0 or p_budget_min::text in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'POST_INVALID_BUDGET';
  end if;
  if p_budget_max is not null and (p_budget_max <= 0 or p_budget_max::text in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'POST_INVALID_BUDGET';
  end if;
  if p_budget_min is not null and p_budget_max is not null and p_budget_min > p_budget_max then
    raise exception 'POST_INVALID_BUDGET_RANGE';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'POST_INVALID_CURRENCY';
  end if;

  update public.commission_posts as post
  set title = v_title,
      description = v_description,
      budget_min = p_budget_min,
      budget_max = p_budget_max,
      currency = p_currency
  where post.id = v_post.id
    and post.owner_id = v_user
    and post.status = 'OPEN'
  returning post.* into v_post;
  if not found then raise exception 'POST_NOT_OPEN'; end if;
  return v_post;
end;
$$;

revoke all on function public.update_commission_post(uuid, text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.update_commission_post(uuid, text, text, numeric, numeric, text)
  to authenticated;

revoke delete on table public.commission_posts from public, anon, authenticated;
create or replace function public.delete_commission_post(p_commission_post_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
  v_deleted_id uuid;
begin
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if v_post.owner_id <> v_user or v_post.owner_role <> v_role then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;
  if v_post.status <> 'OPEN' then raise exception 'POST_NOT_OPEN'; end if;
  if exists (
    select 1 from public.commissions as commission
    where commission.public_post_id = v_post.id
  ) then
    raise exception 'POST_HAS_COMMISSION';
  end if;

  delete from public.commission_posts as post
  where post.id = v_post.id
    and post.owner_id = v_user
    and post.owner_role = v_role
    and post.status = 'OPEN'
  returning post.id into v_deleted_id;
  if not found then raise exception 'POST_NOT_OPEN'; end if;
  return v_deleted_id;
end;
$$;

revoke all on function public.delete_commission_post(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_commission_post(uuid)
  to authenticated;

create or replace function public.reject_commission_post_application(
  p_application_id uuid
)
returns public.commission_post_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post_id uuid;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
begin
  if v_user is null then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;
  select application.commission_post_id into v_post_id
  from public.commission_post_applications as application
  where application.id = p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = v_post_id
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_post.owner_id <> v_user or v_post.owner_role <> v_role then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;
  if v_post.status <> 'OPEN' then raise exception 'APPLICATION_POST_NOT_OPEN'; end if;

  select application.* into v_application
  from public.commission_post_applications as application
  where application.id = p_application_id
    and application.commission_post_id = v_post.id
    and application.applicant_role <> v_post.owner_role
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_application.status <> 'PENDING' then raise exception 'APPLICATION_NOT_PENDING'; end if;

  update public.commission_post_applications as application
  set status = 'REJECTED'
  where application.id = v_application.id
    and application.status = 'PENDING'
  returning application.* into v_application;
  if not found then raise exception 'APPLICATION_NOT_PENDING'; end if;
  return v_application;
end;
$$;

revoke all on function public.reject_commission_post_application(uuid)
  from public, anon, authenticated;
grant execute on function public.reject_commission_post_application(uuid)
  to authenticated;

create or replace function public.list_commission_post_engagement_summaries(
  p_commission_post_ids uuid[]
)
returns table (
  commission_post_id uuid,
  comment_count bigint,
  application_count bigint
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
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  return query
  with requested_posts as (
    select distinct requested.id
    from unnest(coalesce(p_commission_post_ids, array[]::uuid[])) as requested(id)
  ),
  visible_posts as (
    select post.id
    from public.commission_posts as post
    join requested_posts as requested on requested.id = post.id
    where post.owner_id = v_user
       or post.status = 'OPEN'
  ),
  comment_totals as (
    select comment.commission_post_id, count(*) as total
    from public.commission_post_comments as comment
    join visible_posts as visible on visible.id = comment.commission_post_id
    group by comment.commission_post_id
  ),
  application_totals as (
    select application.commission_post_id, count(*) as total
    from public.commission_post_applications as application
    join visible_posts as visible on visible.id = application.commission_post_id
    group by application.commission_post_id
  )
  select visible.id,
         coalesce(comment_totals.total, 0),
         coalesce(application_totals.total, 0)
  from visible_posts as visible
  left join comment_totals on comment_totals.commission_post_id = visible.id
  left join application_totals on application_totals.commission_post_id = visible.id
  order by visible.id;
end;
$$;

revoke all on function public.list_commission_post_engagement_summaries(uuid[])
  from public, anon, authenticated;
grant execute on function public.list_commission_post_engagement_summaries(uuid[])
  to authenticated;

create or replace function public.list_commission_post_comments(
  p_commission_post_id uuid
)
returns table (
  id uuid,
  commission_post_id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  author_avatar_data_url text,
  author_role text,
  body text,
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
  v_post public.commission_posts;
begin
  if v_user is null then raise exception 'COMMENT_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;
  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id;
  if not found then raise exception 'COMMENT_POST_NOT_FOUND'; end if;
  if v_post.owner_id <> v_user
    and not (v_post.status = 'OPEN' and v_post.owner_role <> v_role) then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  return query
  select comment.id, comment.commission_post_id, comment.author_id,
         author.name, author.username, author.avatar_data_url, author.role,
         comment.body, comment.created_at, comment.updated_at
  from public.commission_post_comments as comment
  join public.profiles as author on author.id = comment.author_id
  where comment.commission_post_id = v_post.id
  order by comment.created_at asc, comment.id asc;
end;
$$;

revoke all on function public.list_commission_post_comments(uuid)
  from public, anon, authenticated;
grant execute on function public.list_commission_post_comments(uuid)
  to authenticated;

create or replace function public.create_commission_post_comment(
  p_commission_post_id uuid,
  p_body text
)
returns table (
  id uuid,
  commission_post_id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  author_avatar_data_url text,
  author_role text,
  body text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_author_name text;
  v_post public.commission_posts;
  v_comment public.commission_post_comments;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_user is null then raise exception 'COMMENT_NOT_AUTHORIZED'; end if;
  select profile.role, profile.name
  into v_role, v_author_name
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'COMMENT_POST_NOT_FOUND'; end if;
  if v_post.status <> 'OPEN' then raise exception 'COMMENT_POST_NOT_OPEN'; end if;
  if v_post.owner_id <> v_user and v_post.owner_role = v_role then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;
  if v_body = '' then raise exception 'COMMENT_INVALID_BODY'; end if;
  if char_length(v_body) > 2000 then raise exception 'COMMENT_TOO_LONG'; end if;

  insert into public.commission_post_comments (commission_post_id, author_id, body)
  values (v_post.id, v_user, v_body)
  returning * into v_comment;

  if v_post.owner_id <> v_user then
    insert into public.notifications (
      recipient_id, notification_type, title, message, related_id, related_route
    )
    values (
      v_post.owner_id,
      'commission',
      'New Commission Post Comment',
      coalesce(v_author_name, 'A user') || ' commented on your commission post "' || v_post.title || '".',
      v_post.id,
      '/market'
    );
  end if;

  return query
  select comment.id, comment.commission_post_id, comment.author_id,
         author.name, author.username, author.avatar_data_url, author.role,
         comment.body, comment.created_at, comment.updated_at
  from public.commission_post_comments as comment
  join public.profiles as author on author.id = comment.author_id
  where comment.id = v_comment.id;
end;
$$;

revoke all on function public.create_commission_post_comment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_commission_post_comment(uuid, text)
  to authenticated;

create or replace function public.delete_commission_post_comment(
  p_comment_id uuid
)
returns public.commission_post_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post_id uuid;
  v_comment public.commission_post_comments;
  v_post public.commission_posts;
  v_deleted public.commission_post_comments;
begin
  if v_user is null then raise exception 'COMMENT_NOT_AUTHORIZED'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  select comment.commission_post_id into v_post_id
  from public.commission_post_comments as comment
  where comment.id = p_comment_id;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = v_post_id
  for share;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;

  select comment.* into v_comment
  from public.commission_post_comments as comment
  where comment.id = p_comment_id
    and comment.commission_post_id = v_post.id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_comment.author_id <> v_user
    and (v_post.owner_id <> v_user or v_post.owner_role <> v_role) then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  delete from public.commission_post_comments as comment
  where comment.id = v_comment.id
  returning comment.* into v_deleted;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  return v_deleted;
end;
$$;

revoke all on function public.delete_commission_post_comment(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_commission_post_comment(uuid)
  to authenticated;
