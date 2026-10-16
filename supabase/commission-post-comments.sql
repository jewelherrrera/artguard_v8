-- ArtGuard Hub: persistent comments for public commission posts.
-- Run after schema.sql and commission-posts-foundation.sql.
-- Reads and writes are available only through the authenticated RPCs below.

create table public.commission_post_comments (
  id uuid primary key default gen_random_uuid(),
  commission_post_id uuid not null
    references public.commission_posts(id) on delete cascade,
  author_id uuid not null
    references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_post_comments_body_not_blank
    check (length(btrim(body)) > 0),
  constraint commission_post_comments_body_max_length
    check (char_length(body) <= 2000)
);

create index commission_post_comments_post_created_idx
  on public.commission_post_comments(commission_post_id, created_at desc);

alter table public.commission_post_comments enable row level security;

revoke all on table public.commission_post_comments from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.commission_post_comments
  from public, anon, authenticated;

drop trigger if exists commission_post_comments_set_updated_at
  on public.commission_post_comments;
create trigger commission_post_comments_set_updated_at
before update on public.commission_post_comments
for each row execute function public.set_updated_at();

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

  select p.role into v_role
  from public.profiles p
  where p.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  select p.* into v_post
  from public.commission_posts p
  where p.id = p_commission_post_id;
  if not found then raise exception 'COMMENT_POST_NOT_FOUND'; end if;

  if not (
    (v_role = 'client' and v_post.client_id = v_user)
    or (v_role = 'artist' and v_post.status = 'OPEN')
  ) then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  return query
  select
    c.id,
    c.commission_post_id,
    c.author_id,
    author.name,
    author.username,
    author.avatar_data_url,
    author.role,
    c.body,
    c.created_at,
    c.updated_at
  from public.commission_post_comments c
  join public.profiles author on author.id = c.author_id
  where c.commission_post_id = v_post.id
  order by c.created_at asc, c.id asc;
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
  v_post public.commission_posts;
  v_comment public.commission_post_comments;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_user is null then raise exception 'COMMENT_NOT_AUTHORIZED'; end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  select p.* into v_post
  from public.commission_posts p
  where p.id = p_commission_post_id
  for update;
  if not found then raise exception 'COMMENT_POST_NOT_FOUND'; end if;
  if v_post.status <> 'OPEN' then raise exception 'COMMENT_POST_NOT_OPEN'; end if;

  if v_role = 'client' and v_post.client_id <> v_user then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  if v_body = '' then raise exception 'COMMENT_INVALID_BODY'; end if;
  if char_length(v_body) > 2000 then raise exception 'COMMENT_TOO_LONG'; end if;

  insert into public.commission_post_comments (
    commission_post_id,
    author_id,
    body
  )
  values (
    v_post.id,
    v_user,
    v_body
  )
  returning * into v_comment;

  return query
  select
    c.id,
    c.commission_post_id,
    c.author_id,
    author.name,
    author.username,
    author.avatar_data_url,
    author.role,
    c.body,
    c.created_at,
    c.updated_at
  from public.commission_post_comments c
  join public.profiles author on author.id = c.author_id
  where c.id = v_comment.id;
end;
$$;

revoke all on function public.create_commission_post_comment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_commission_post_comment(uuid, text)
  to authenticated;
