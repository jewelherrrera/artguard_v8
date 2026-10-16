-- ArtGuard Hub: Artist-level commission availability.
-- Run after artist-commission-services.sql and commission-request-review.sql.
-- Existing commissions and individual service activity are preserved.

alter table public.profiles
  add column if not exists accepting_commissions boolean not null default true;

-- Preserve the established profile column allowlist. Availability is writable
-- only through set_artist_commission_availability().
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

create or replace function public.set_artist_commission_availability(p_accepting boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_accepting is null then raise exception 'Availability value is required'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artist accounts can change commission availability'; end if;

  update public.profiles
  set accepting_commissions = p_accepting
  where id = v_user;

  return p_accepting;
end;
$$;

revoke all on function public.set_artist_commission_availability(boolean) from public, anon, authenticated;
grant execute on function public.set_artist_commission_availability(boolean) to authenticated;

create or replace function public.create_service_commission_request(
  p_service_id uuid,
  p_title text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := auth.uid();
  v_client_role text;
  v_client_name text;
  v_service public.artist_commission_services;
  v_artist_role text;
  v_accepting_commissions boolean;
  v_existing public.commissions;
  v_created public.commissions;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_order_ref text := 'CM-' || gen_random_uuid()::text;
begin
  if v_client_id is null then raise exception 'Not authenticated'; end if;
  if v_title is null then raise exception 'Commission title is required'; end if;
  if v_description is null then raise exception 'Commission description is required'; end if;

  select role, name into v_client_role, v_client_name
  from public.profiles
  where id = v_client_id;
  if v_client_role is null then raise exception 'Client profile not found'; end if;
  if v_client_role <> 'client' then raise exception 'Only client accounts can create commission requests'; end if;

  select * into v_service
  from public.artist_commission_services
  where id = p_service_id and is_active = true;
  if v_service.id is null then raise exception 'Active commission service not found'; end if;
  if v_service.artist_id = v_client_id then raise exception 'Clients cannot request their own service'; end if;

  select role into v_artist_role
  from public.profiles
  where id = v_service.artist_id;
  if v_artist_role is null or v_artist_role <> 'artist' then raise exception 'Service artist is not valid'; end if;

  select * into v_existing
  from public.commissions
  where client_id = v_client_id
    and artist_id = v_service.artist_id
    and status in ('REQUESTED', 'ACCEPTED')
  order by requested_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object('commission_id', v_existing.id, 'created', false);
  end if;

  -- Lock the Artist profile so availability cannot change between this check
  -- and the new commission insert. Existing requests above remain reusable.
  select accepting_commissions into v_accepting_commissions
  from public.profiles
  where id = v_service.artist_id
  for update;
  if not found or v_accepting_commissions is distinct from true then
    raise exception 'ARTIST_NOT_ACCEPTING_COMMISSIONS';
  end if;

  insert into public.commissions (
    order_ref,
    client_id,
    artist_id,
    title,
    description,
    status,
    requested_at,
    service_id,
    service_name_snapshot,
    amount,
    currency,
    turnaround_days_snapshot
  )
  values (
    v_order_ref,
    v_client_id,
    v_service.artist_id,
    v_title,
    v_description,
    'REQUESTED',
    now(),
    v_service.id,
    v_service.name,
    v_service.price,
    v_service.currency,
    v_service.turnaround_days
  )
  returning * into v_created;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_created.artist_id,
    'commission',
    'New Commission Request',
    coalesce(v_client_name, 'A client') || ' sent a commission request for ' || v_service.name || '.',
    v_created.id,
    '/home/workspace/' || v_created.id::text
  );

  return jsonb_build_object('commission_id', v_created.id, 'created', true);
end;
$$;

revoke all on function public.create_service_commission_request(uuid, text, text) from public;
grant execute on function public.create_service_commission_request(uuid, text, text) to authenticated;

create or replace function public.create_commission_request(
  p_artist_id uuid,
  p_title text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := auth.uid();
  v_client_role text;
  v_artist_role text;
  v_client_name text;
  v_accepting_commissions boolean;
  v_existing public.commissions;
  v_created public.commissions;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_order_ref text := 'CM-' || gen_random_uuid()::text;
begin
  if v_client_id is null then raise exception 'Not authenticated'; end if;
  if p_artist_id is null or p_artist_id = v_client_id then raise exception 'Invalid artist'; end if;
  if v_title is null then raise exception 'Commission title is required'; end if;
  if v_description is null then raise exception 'Commission description is required'; end if;

  select role, name into v_client_role, v_client_name
  from public.profiles where id = v_client_id;
  select role into v_artist_role
  from public.profiles where id = p_artist_id;

  if v_client_role is null then raise exception 'Client profile not found'; end if;
  if v_client_role <> 'client' then raise exception 'Only client accounts can create commission requests'; end if;
  if v_artist_role is null then raise exception 'Artist profile not found'; end if;
  if v_artist_role <> 'artist' then raise exception 'The selected account is not an artist'; end if;

  select * into v_existing
  from public.commissions
  where client_id = v_client_id
    and artist_id = p_artist_id
    and status in ('REQUESTED', 'ACCEPTED')
  order by requested_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object('commission_id', v_existing.id, 'created', false);
  end if;

  -- Lock the Artist profile so availability cannot change between this check
  -- and the new commission insert. Existing requests above remain reusable.
  select accepting_commissions into v_accepting_commissions
  from public.profiles
  where id = p_artist_id
  for update;
  if not found then raise exception 'Artist profile not found'; end if;
  if v_accepting_commissions is distinct from true then
    raise exception 'ARTIST_NOT_ACCEPTING_COMMISSIONS';
  end if;

  insert into public.commissions (
    order_ref, client_id, artist_id, title, description, status, requested_at
  )
  values (
    v_order_ref, v_client_id, p_artist_id, v_title, v_description, 'REQUESTED', now()
  )
  returning * into v_created;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    p_artist_id,
    'commission',
    'New Commission Request',
    'You received a new commission request from ' || coalesce(v_client_name, 'a client') || '.',
    v_created.id,
    '/home/workspace/' || v_created.id::text
  );

  return jsonb_build_object('commission_id', v_created.id, 'created', true);
end;
$$;

revoke all on function public.create_commission_request(uuid, text, text) from public;
grant execute on function public.create_commission_request(uuid, text, text) to authenticated;