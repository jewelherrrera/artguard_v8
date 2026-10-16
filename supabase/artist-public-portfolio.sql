-- ArtGuard Hub: public protected portfolio previews
-- Run after artworks.sql. Originals remain private.

drop function if exists public.list_public_artist_artworks(uuid);
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
  order by a.created_at desc;
end;
$$;

revoke all on function public.list_public_artist_artworks(uuid) from public;
grant execute on function public.list_public_artist_artworks(uuid) to authenticated;

-- Storage policies cannot safely use the owner-restricted artworks table directly.
-- This definer function validates the exact derivative path while bypassing that
-- table policy, without exposing any artwork row to the caller.
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
      and object_path like '%/protected/%'
  );
$$;

revoke all on function public.is_public_artwork_derivative(text) from public;
grant execute on function public.is_public_artwork_derivative(text) to authenticated;

drop policy if exists "authenticated users can read ready protected portfolios" on storage.objects;
create policy "authenticated users can read ready protected portfolios"
on storage.objects for select
to authenticated
using (
  bucket_id = 'artworks'
  and public.is_public_artwork_derivative(name)
);
