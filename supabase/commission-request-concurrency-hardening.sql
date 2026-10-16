-- ArtGuard Hub: serialize request deduplication and Artist decisions.
-- Run after artist-commission-availability.sql and commission-request-review.sql.
-- Existing request, availability, notification, snapshot, and authorization behavior is preserved.

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

  -- Serialize all requests to this Artist, including service and legacy requests.
  select accepting_commissions into v_accepting_commissions
  from public.profiles
  where id = v_service.artist_id
  for update;
  if not found then raise exception 'Service artist is not valid'; end if;

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
  if v_accepting_commissions is distinct from true then
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

revoke all on function public.create_service_commission_request(uuid, text, text) from public, anon, authenticated;
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

  -- Use the same Artist-row lock as service requests and availability updates.
  select accepting_commissions into v_accepting_commissions
  from public.profiles
  where id = p_artist_id
  for update;
  if not found then raise exception 'Artist profile not found'; end if;

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

revoke all on function public.create_commission_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_commission_request(uuid, text, text) to authenticated;

create or replace function public.accept_commission_request(p_commission_id uuid)
returns public.commissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_artist_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role, name into v_role, v_artist_name from public.profiles where id = v_user;

  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.status <> 'REQUESTED' then
    raise exception 'Only requested commissions can be accepted';
  end if;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can accept commission requests'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;

  update public.commissions
  set status = 'ACCEPTED', accepted_at = now()
  where id = p_commission_id
    and status = 'REQUESTED'
  returning * into v_commission;
  if not found then raise exception 'Only requested commissions can be accepted'; end if;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.client_id,
    'commission',
    'Commission Request Accepted',
    'Your commission request has been accepted by ' || coalesce(v_artist_name, 'the artist') || '.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_commission;
end;
$$;

revoke all on function public.accept_commission_request(uuid) from public, anon, authenticated;
grant execute on function public.accept_commission_request(uuid) to authenticated;

create or replace function public.reject_commission_request(
  p_commission_id uuid,
  p_reason text
)
returns public.commissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_artist_name text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_reason is null then raise exception 'A rejection reason is required'; end if;
  select role, name into v_role, v_artist_name from public.profiles where id = v_user;

  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.status <> 'REQUESTED' then
    raise exception 'Only requested commissions can be rejected';
  end if;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can reject commission requests'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;

  update public.commissions
  set status = 'REJECTED', rejected_at = now(), rejection_reason = v_reason
  where id = p_commission_id
    and status = 'REQUESTED'
  returning * into v_commission;
  if not found then raise exception 'Only requested commissions can be rejected'; end if;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.client_id,
    'commission',
    'Commission Request Rejected',
    'Your commission request was rejected by ' || coalesce(v_artist_name, 'the artist') || '. Reason: ' || v_reason,
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_commission;
end;
$$;

revoke all on function public.reject_commission_request(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_commission_request(uuid, text) to authenticated;
