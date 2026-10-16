-- ArtGuard Hub: Batch 3A admin artist-verification review
-- Run after artist-verification-foundation.sql and artist-verification-submission.sql.
-- Adds only admin-gated review functions. No tables, columns, or policies are recreated.

create or replace function public.list_pending_artist_verifications()
returns table (
  artist_id uuid,
  artist_name text,
  username text,
  bio text,
  interests text[],
  artist_verification_status text,
  artist_verification_submitted_at timestamptz,
  artwork_references jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select p.is_admin into v_is_admin
  from public.profiles p
  where p.id = auth.uid();

  if auth.uid() is null or coalesce(v_is_admin, false) is not true then
    raise exception 'Admin access required';
  end if;

  return query
  select
    p.id,
    p.name,
    p.username,
    p.bio,
    p.interests,
    p.artist_verification_status,
    p.artist_verification_submitted_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'original_filename', a.original_filename,
          'status', a.status,
          'created_at', a.created_at
        ) order by a.created_at desc)
        from public.artworks a
        where a.owner_id = p.id
      ),
      '[]'::jsonb
    )
  from public.profiles p
  where p.role = 'artist'
    and p.artist_verification_status = 'pending'
  order by p.artist_verification_submitted_at asc nulls last;
end;
$$;

create or replace function public.approve_artist_verification(p_artist_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_profile public.profiles;
begin
  select p.is_admin into v_is_admin
  from public.profiles p
  where p.id = auth.uid();

  if auth.uid() is null or coalesce(v_is_admin, false) is not true then
    raise exception 'Admin access required';
  end if;

  update public.profiles
  set artist_verification_status = 'verified',
      artist_verification_reviewed_at = now(),
      artist_verification_reviewed_by = auth.uid(),
      artist_verification_rejection_reason = null
  where id = p_artist_id
    and role = 'artist'
    and artist_verification_status = 'pending'
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Only pending artist applications can be approved';
  end if;

  return v_profile;
end;
$$;

create or replace function public.reject_artist_verification(
  p_artist_id uuid,
  p_rejection_reason text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_profile public.profiles;
  v_reason text := nullif(trim(p_rejection_reason), '');
begin
  select p.is_admin into v_is_admin
  from public.profiles p
  where p.id = auth.uid();

  if auth.uid() is null or coalesce(v_is_admin, false) is not true then
    raise exception 'Admin access required';
  end if;

  if v_reason is null then
    raise exception 'A rejection reason is required';
  end if;

  update public.profiles
  set artist_verification_status = 'rejected',
      artist_verification_reviewed_at = now(),
      artist_verification_reviewed_by = auth.uid(),
      artist_verification_rejection_reason = v_reason
  where id = p_artist_id
    and role = 'artist'
    and artist_verification_status = 'pending'
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Only pending artist applications can be rejected';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.list_pending_artist_verifications() from public;
revoke all on function public.approve_artist_verification(uuid) from public;
revoke all on function public.reject_artist_verification(uuid, text) from public;

grant execute on function public.list_pending_artist_verifications() to authenticated;
grant execute on function public.approve_artist_verification(uuid) to authenticated;
grant execute on function public.reject_artist_verification(uuid, text) to authenticated;
