-- ArtGuard Hub: persistent likes and comments for Discover artwork.
-- Apply manually after the artwork base schema, artist portfolio RPC, and
-- artwork-publication.sql. The latter must be applied after its documented
-- protection, verification, and commission-deliverable prerequisites.
-- This migration does not create test data.

create table if not exists public.artwork_likes (
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (artwork_id, user_id)
);

create index if not exists artwork_likes_user_idx
  on public.artwork_likes(user_id, artwork_id);

create table if not exists public.artwork_comments (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint artwork_comments_body_not_blank check (body ~ '[^[:space:]]'),
  constraint artwork_comments_body_max_length check (char_length(body) <= 2000)
);

create index if not exists artwork_comments_artwork_created_idx
  on public.artwork_comments(artwork_id, created_at, id);

alter table public.artwork_likes enable row level security;
alter table public.artwork_comments enable row level security;

revoke all on table public.artwork_likes from public, anon, authenticated;
revoke all on table public.artwork_comments from public, anon, authenticated;

drop policy if exists "users can read likes for discover artwork" on public.artwork_likes;
create policy "users can read likes for discover artwork"
on public.artwork_likes for select
to authenticated
using (
  exists (
    select 1 from public.artworks a
    where a.id = artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  )
);

drop policy if exists "users can like discover artwork" on public.artwork_likes;
create policy "users can like discover artwork"
on public.artwork_likes for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.artworks a
    where a.id = artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  )
);

drop policy if exists "users can remove their discover artwork likes" on public.artwork_likes;
create policy "users can remove their discover artwork likes"
on public.artwork_likes for delete
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.artworks a
    where a.id = artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  )
);

drop policy if exists "users can read comments for discover artwork" on public.artwork_comments;
create policy "users can read comments for discover artwork"
on public.artwork_comments for select
to authenticated
using (
  exists (
    select 1 from public.artworks a
    where a.id = artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  )
);

drop policy if exists "users can comment on discover artwork" on public.artwork_comments;
create policy "users can comment on discover artwork"
on public.artwork_comments for insert
to authenticated
with check (
  author_id = auth.uid()
  and body ~ '[^[:space:]]'
  and char_length(body) <= 2000
  and exists (
    select 1 from public.artworks a
    where a.id = artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  )
);

drop policy if exists "users can delete their discover artwork comments" on public.artwork_comments;
create policy "users can delete their discover artwork comments"
on public.artwork_comments for delete
to authenticated
using (
  author_id = auth.uid()
  and exists (
    select 1 from public.artworks a
    where a.id = artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  )
);

create or replace function public.list_discover_artwork_engagement()
returns table (
  artwork_id uuid,
  like_count bigint,
  comment_count bigint,
  liked_by_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'ENGAGEMENT_NOT_AUTHENTICATED'; end if;

  return query
  select
    a.id,
    (select count(*) from public.artwork_likes l where l.artwork_id = a.id),
    (select count(*) from public.artwork_comments c where c.artwork_id = a.id),
    exists (
      select 1 from public.artwork_likes l
      where l.artwork_id = a.id and l.user_id = v_user
    )
  from public.artworks a
  where a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility = 'discover'
    and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist');
end;
$$;

revoke all on function public.list_discover_artwork_engagement() from public, anon, authenticated;
grant execute on function public.list_discover_artwork_engagement() to authenticated;

create or replace function public.set_discover_artwork_like(
  p_artwork_id uuid,
  p_liked boolean
)
returns table (like_count bigint, liked_by_me boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'ENGAGEMENT_NOT_AUTHENTICATED'; end if;
  if p_liked is null then raise exception 'ENGAGEMENT_INVALID_LIKE'; end if;

  perform 1
  from public.artworks a
  where a.id = p_artwork_id
    and a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility = 'discover'
    and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  for share;
  if not found then raise exception 'ENGAGEMENT_ARTWORK_NOT_ELIGIBLE'; end if;

  if p_liked then
    insert into public.artwork_likes (artwork_id, user_id)
    values (p_artwork_id, v_user)
    on conflict (artwork_id, user_id) do nothing;
  else
    delete from public.artwork_likes
    where artwork_id = p_artwork_id
      and user_id = v_user;
  end if;

  return query
  select
    (select count(*) from public.artwork_likes l where l.artwork_id = p_artwork_id),
    exists (
      select 1 from public.artwork_likes l
      where l.artwork_id = p_artwork_id and l.user_id = v_user
    );
end;
$$;

revoke all on function public.set_discover_artwork_like(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_discover_artwork_like(uuid, boolean) to authenticated;

create or replace function public.list_discover_artwork_comments(p_artwork_id uuid)
returns table (
  id uuid,
  artwork_id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  author_avatar_data_url text,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'ENGAGEMENT_NOT_AUTHENTICATED'; end if;
  if not exists (
    select 1 from public.artworks a
    where a.id = p_artwork_id
      and a.status = 'ready'
      and a.protected_storage_path is not null
      and a.visibility = 'discover'
      and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  ) then
    raise exception 'ENGAGEMENT_ARTWORK_NOT_ELIGIBLE';
  end if;

  return query
  select
    c.id,
    c.artwork_id,
    c.author_id,
    p.name,
    p.username,
    p.avatar_data_url,
    c.body,
    c.created_at
  from public.artwork_comments c
  join public.profiles p on p.id = c.author_id
  where c.artwork_id = p_artwork_id
  order by c.created_at asc, c.id asc;
end;
$$;

revoke all on function public.list_discover_artwork_comments(uuid) from public, anon, authenticated;
grant execute on function public.list_discover_artwork_comments(uuid) to authenticated;

create or replace function public.create_discover_artwork_comment(
  p_artwork_id uuid,
  p_body text
)
returns table (
  id uuid,
  artwork_id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  author_avatar_data_url text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_body text := regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_comment public.artwork_comments;
begin
  if v_user is null then raise exception 'ENGAGEMENT_NOT_AUTHENTICATED'; end if;
  if v_body = '' then raise exception 'ENGAGEMENT_INVALID_COMMENT'; end if;
  if char_length(v_body) > 2000 then raise exception 'ENGAGEMENT_COMMENT_TOO_LONG'; end if;

  perform 1
  from public.artworks a
  where a.id = p_artwork_id
    and a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility = 'discover'
    and exists (select 1 from public.profiles p where p.id = a.owner_id and p.role = 'artist')
  for share;
  if not found then raise exception 'ENGAGEMENT_ARTWORK_NOT_ELIGIBLE'; end if;

  insert into public.artwork_comments (artwork_id, author_id, body)
  values (p_artwork_id, v_user, v_body)
  returning * into v_comment;

  return query
  select
    c.id,
    c.artwork_id,
    c.author_id,
    p.name,
    p.username,
    p.avatar_data_url,
    c.body,
    c.created_at
  from public.artwork_comments c
  join public.profiles p on p.id = c.author_id
  where c.id = v_comment.id;
end;
$$;

revoke all on function public.create_discover_artwork_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_discover_artwork_comment(uuid, text) to authenticated;
