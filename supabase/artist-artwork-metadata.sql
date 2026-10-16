-- ArtGuard Hub: Artist-owned artwork metadata editing.
-- Run after artworks.sql and artist-protection-rls-migration.sql.
-- Only title and description can be changed through this RPC.

create or replace function public.update_my_artwork_metadata(
  p_artwork_id uuid,
  p_title text,
  p_description text
)
returns public.artworks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_artwork public.artworks;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_title is null then raise exception 'Artwork title is required'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only Artist accounts can edit artwork metadata'; end if;

  if not exists (
    select 1
    from public.artworks a
    where a.id = p_artwork_id
      and a.owner_id = v_user
  ) then
    raise exception 'Artwork not found or not owned by the current Artist';
  end if;

  update public.artworks
  set title = v_title,
      description = v_description
  where id = p_artwork_id
    and owner_id = v_user
  returning * into v_artwork;

  return v_artwork;
end;
$$;

revoke all on function public.update_my_artwork_metadata(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_my_artwork_metadata(uuid, text, text) to authenticated;