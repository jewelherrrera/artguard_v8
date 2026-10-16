-- Allow authenticated Marketplace reads under the existing active-service RLS policy.
-- No anon access or write privileges are granted.
revoke all on public.artist_commission_services from public, anon, authenticated;
grant select on public.artist_commission_services to authenticated;
