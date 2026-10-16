-- ArtGuard Hub: verification notifications integration
-- Run after notifications.sql and the latest verification RPC migrations.
-- Notifications are created inside the secure verification transactions.

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

  insert into public.notifications (
    recipient_id,
    notification_type,
    title,
    message,
    related_id,
    related_route
  ) values (
    v_user_id,
    'verification',
    'Verification Submitted',
    'Your artist verification application has been submitted and is awaiting review.',
    p_artwork_id,
    '/profile/settings/verification'
  );

  return v_profile;
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

  insert into public.notifications (
    recipient_id,
    notification_type,
    title,
    message,
    related_id,
    related_route
  ) values (
    v_profile.id,
    'verification',
    'Artist Verification Approved',
    'Your ArtGuard Hub artist account has been verified.',
    v_profile.id,
    '/profile/settings/verification'
  );

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

  insert into public.notifications (
    recipient_id,
    notification_type,
    title,
    message,
    related_id,
    related_route
  ) values (
    v_profile.id,
    'verification',
    'Artist Verification Rejected',
    'Your artist verification needs revision. Reason: ' || v_reason,
    v_profile.id,
    '/profile/settings/verification'
  );

  return v_profile;
end;
$$;

revoke all on function public.submit_artist_verification(text, text, text[], uuid) from public;
revoke all on function public.approve_artist_verification(uuid) from public;
revoke all on function public.reject_artist_verification(uuid, text) from public;

grant execute on function public.submit_artist_verification(text, text, text[], uuid) to authenticated;
grant execute on function public.approve_artist_verification(uuid) to authenticated;
grant execute on function public.reject_artist_verification(uuid, text) to authenticated;
