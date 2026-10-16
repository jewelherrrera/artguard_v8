-- ArtGuard Hub: artwork publication and Discover categories.
-- Apply manually after artworks.sql, protection.sql, artist-public-portfolio.sql,
-- artist-verification-admin-preview.sql, and commission-deliverables-foundation.sql.
-- This migration is forward-only and never alters original-file policies.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'artworks'
      and column_name = 'visibility'
  ) then
    alter table public.artworks add column visibility text;

    update public.artworks
    set visibility = case
      when status = 'ready' and protected_storage_path is not null then 'portfolio'
      else 'private'
    end;
  end if;
end;
$$;

alter table public.artworks alter column visibility set default 'private';
alter table public.artworks alter column visibility set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'artworks_visibility_allowed'
      and conrelid = 'public.artworks'::regclass
  ) then
    alter table public.artworks
      add constraint artworks_visibility_allowed
      check (visibility in ('private', 'portfolio', 'discover'));
  end if;
end;
$$;

alter table public.artworks
  add column if not exists category text not null default 'Other';

create index if not exists artworks_discover_created_idx
  on public.artworks(created_at desc)
  where visibility = 'discover'
    and status = 'ready'
    and protected_storage_path is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'artworks_category_allowed'
      and conrelid = 'public.artworks'::regclass
  ) then
    alter table public.artworks
      add constraint artworks_category_allowed
      check (category in ('Character', 'Chibi', 'Concept Art', 'Portrait', 'Fanart', 'Environment', 'Other'));
  end if;
end;
$$;

create or replace function public.update_my_artwork_visibility(
  p_artwork_id uuid,
  p_visibility text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_status text;
  v_protected_path text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_visibility is null or p_visibility not in ('private', 'portfolio', 'discover') then
    raise exception 'Invalid artwork publication setting';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'artist' then
    raise exception 'Only Artist accounts can publish artwork';
  end if;

  select status, protected_storage_path
    into v_status, v_protected_path
  from public.artworks
  where id = p_artwork_id
    and owner_id = v_user
  for update;

  if not found then
    raise exception 'Artwork not found or not owned by the current Artist';
  end if;
  if p_visibility <> 'private'
    and (v_status <> 'ready' or v_protected_path is null) then
    raise exception 'Only ready protected artwork can be published';
  end if;

  update public.artworks
  set visibility = p_visibility
  where id = p_artwork_id
    and owner_id = v_user;

  return p_visibility;
end;
$$;

revoke all on function public.update_my_artwork_visibility(uuid, text) from public, anon, authenticated;
grant execute on function public.update_my_artwork_visibility(uuid, text) to authenticated;

create or replace function public.list_public_artist_artworks(p_artist_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  protected_storage_path text,
  created_at timestamptz,
  dynamic_cloaking boolean,
  canvas_tiling boolean,
  right_click_shield boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where profiles.id = p_artist_id
      and profiles.role = 'artist'
  ) then
    raise exception 'Artist profile not found';
  end if;

  return query
  select
    a.id,
    a.title,
    a.description,
    a.protected_storage_path,
    a.created_at,
    coalesce(s.dynamic_cloaking, false),
    coalesce(s.canvas_tiling, false),
    coalesce(s.right_click_shield, false)
  from public.artworks a
  left join public.artwork_protection_settings s
    on s.artwork_id = a.id
   and s.owner_id = p_artist_id
  where a.owner_id = p_artist_id
    and a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility in ('portfolio', 'discover')
  order by a.created_at desc;
end;
$$;

revoke all on function public.list_public_artist_artworks(uuid) from public, anon;
grant execute on function public.list_public_artist_artworks(uuid) to authenticated;

create or replace function public.list_discover_artworks()
returns table (
  id uuid,
  title text,
  description text,
  protected_storage_path text,
  category text,
  created_at timestamptz,
  artist_id uuid,
  artist_name text,
  artist_username text,
  artist_avatar_data_url text,
  dynamic_cloaking boolean,
  canvas_tiling boolean,
  right_click_shield boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.id,
    a.title,
    a.description,
    a.protected_storage_path,
    a.category,
    a.created_at,
    p.id,
    p.name,
    p.username,
    p.avatar_data_url,
    coalesce(s.dynamic_cloaking, false),
    coalesce(s.canvas_tiling, false),
    coalesce(s.right_click_shield, false)
  from public.artworks a
  join public.profiles p on p.id = a.owner_id and p.role = 'artist'
  left join public.artwork_protection_settings s
    on s.artwork_id = a.id
   and s.owner_id = a.owner_id
  where a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility = 'discover'
  order by a.created_at desc;
$$;

revoke all on function public.list_discover_artworks() from public, anon;
grant execute on function public.list_discover_artworks() to authenticated;

-- A ready derivative is not public by default. Only portfolio/discover
-- visibility grants authenticated access; originals and commission paths
-- continue to be governed by their existing, separate policies.
create or replace function public.is_public_artwork_derivative(object_path text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.artworks a
    where a.protected_storage_path = object_path
      and a.status = 'ready'
      and a.visibility in ('portfolio', 'discover')
      and object_path like '%/protected/%'
  );
$$;

revoke all on function public.is_public_artwork_derivative(text) from public, anon;
grant execute on function public.is_public_artwork_derivative(text) to authenticated;

drop policy if exists "authenticated users can read ready protected portfolios" on storage.objects;
create policy "authenticated users can read ready protected portfolios"
on storage.objects for select
to authenticated
using (
  bucket_id = 'artworks'
  and public.is_public_artwork_derivative(name)
);
