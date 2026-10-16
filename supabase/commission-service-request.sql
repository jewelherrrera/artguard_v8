-- ArtGuard Hub: Pricing Batch C1 - service-based commission requests
-- Preserves legacy commission requests and existing commission data.

alter table public.commissions
  add column if not exists service_id uuid references public.artist_commission_services(id),
  add column if not exists service_name_snapshot text,
  add column if not exists amount numeric(12, 2),
  add column if not exists currency text,
  add column if not exists turnaround_days_snapshot integer;

create index if not exists commissions_service_idx
  on public.commissions(service_id);

-- Commission lifecycle remains RPC-only for authenticated clients.
revoke insert on public.commissions from authenticated;
revoke update on public.commissions from authenticated;

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