-- ArtGuard Hub: Batch 2 artist verification submission
-- Run after artist-verification-foundation.sql.
-- This adds applicant submission only. It does not add admin review actions.

create or replace function public.submit_artist_verification(
  p_display_name text,
  p_introduction text,
  p_interests text[]
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
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

  if v_display_name is null or v_introduction is null or cardinality(v_interests) = 0 then
    raise exception 'Display name, introduction, and at least one specialty are required';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_user_id;

  if v_profile.id is null then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'artist' then
    raise exception 'Only artist accounts can submit verification';
  end if;

  if v_profile.artist_verification_status not in ('not_started', 'rejected') then
    raise exception 'This verification application cannot be submitted in its current status';
  end if;

  update public.profiles
  set name = v_display_name,
      bio = v_introduction,
      interests = v_interests,
      artist_verification_status = 'pending',
      artist_verification_submitted_at = now()
  where id = v_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.submit_artist_verification(text, text, text[]) from public;
grant execute on function public.submit_artist_verification(text, text, text[]) to authenticated;
