-- ArtGuard Hub: verification sample artwork relation and submission update
-- Run after artist-verification-submission.sql.

alter table public.profiles
  add column if not exists artist_verification_artwork_id uuid references public.artworks(id) on delete set null;

-- Replace the Batch 2 submission function with an owner-validated sample reference.
drop function if exists public.submit_artist_verification(text, text, text[]);

create or replace function public.submit_artist_verification(
  p_display_name text,
  p_introduction text,
  p_interests text[],
  p_artwork_id uuid
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_artwork public.artworks;
  v_display_name text := nullif(trim(p_display_name), '');
  v_introduction text := nullif(trim(p_introduction), '');
  v_interests text[] := coalesce(
    array(
      select trim(value)
      from unnest(coalesce(p_interests, '{}'::text[])) as value
      where trim(value) <> ''
    ),
    '{}'::text[]
  );
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_display_name is null or v_introduction is null or cardinality(v_interests) = 0 or p_artwork_id is null then
    raise exception 'Display name, introduction, specialties, and a sample artwork are required';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if v_profile.id is null then raise exception 'Profile not found'; end if;
  if v_profile.role <> 'artist' then raise exception 'Only artist accounts can submit verification'; end if;
  if v_profile.artist_verification_status not in ('not_started', 'rejected') then
    raise exception 'This verification application cannot be submitted in its current status';
  end if;

  select * into v_artwork
  from public.artworks
  where id = p_artwork_id
    and owner_id = v_user_id;
  if v_artwork.id is null or v_artwork.status <> 'ready' or v_artwork.protected_storage_path is null then
    raise exception 'Choose one of your ready protected artworks as the verification sample';
  end if;

  update public.profiles
  set name = v_display_name,
      bio = v_introduction,
      interests = v_interests,
      artist_verification_artwork_id = p_artwork_id,
      artist_verification_status = 'pending',
      artist_verification_submitted_at = now()
  where id = v_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.submit_artist_verification(text, text, text[], uuid) from public;
grant execute on function public.submit_artist_verification(text, text, text[], uuid) to authenticated;

-- Expose the selected sample marker to the admin review RPC without exposing originals.
drop function if exists public.list_pending_artist_verifications();
create or replace function public.list_pending_artist_verifications()
returns table (
  artist_id uuid,
  artist_name text,
  username text,
  bio text,
  interests text[],
  artist_verification_status text,
  artist_verification_submitted_at timestamptz,
  artist_verification_artwork_id uuid,
  artwork_references jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select p.is_admin into v_is_admin from public.profiles p where p.id = auth.uid();
  if auth.uid() is null or coalesce(v_is_admin, false) is not true then raise exception 'Admin access required'; end if;

  return query
  select p.id, p.name, p.username, p.bio, p.interests, p.artist_verification_status,
    p.artist_verification_submitted_at, p.artist_verification_artwork_id,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'original_filename', a.original_filename,
      'status', a.status, 'protected_storage_path', a.protected_storage_path,
      'created_at', a.created_at, 'is_verification_sample', a.id = p.artist_verification_artwork_id
    ) order by a.created_at desc) from public.artworks a where a.owner_id = p.id), '[]'::jsonb)
  from public.profiles p
  where p.role = 'artist' and p.artist_verification_status = 'pending'
  order by p.artist_verification_submitted_at asc nulls last;
end;
$$;

grant execute on function public.list_pending_artist_verifications() to authenticated;
