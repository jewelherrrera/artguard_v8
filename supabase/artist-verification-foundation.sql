-- ArtGuard Hub: Batch 1 artist verification foundation
-- Safe to run against an existing database. This migration does not create or
-- recreate tables, triggers, unrelated policies, or storage objects.

alter table public.profiles
  add column if not exists artist_verification_status text not null default 'not_started',
  add column if not exists artist_verification_submitted_at timestamptz,
  add column if not exists artist_verification_reviewed_at timestamptz,
  add column if not exists artist_verification_reviewed_by uuid references auth.users(id),
  add column if not exists artist_verification_rejection_reason text,
  add column if not exists is_admin boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_artist_verification_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_artist_verification_status_check
      check (artist_verification_status in ('not_started', 'pending', 'verified', 'rejected'));
  end if;
end
$$;

-- Keep the existing self-row RLS policy, but restrict authenticated users to
-- the profile columns used by the current normal profile-editing flow.
-- Verification and admin columns remain readable through existing SELECT
-- policies, but cannot be changed by the authenticated client role.
revoke update on table public.profiles from authenticated;

grant update (
  name,
  username,
  bio,
  interests,
  avatar_data_url,
  is_pro,
  onboarded,
  last_seen_at
) on table public.profiles to authenticated;
