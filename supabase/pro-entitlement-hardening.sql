-- ArtGuard Hub: make Pro entitlement server-controlled.
-- Run after artist-verification-foundation.sql and artist-commission-availability.sql.
-- Existing is_pro values are preserved; this only removes client write access.

revoke update on table public.profiles from authenticated;

grant update (
  name,
  username,
  bio,
  interests,
  avatar_data_url,
  onboarded,
  last_seen_at
) on table public.profiles to authenticated;
