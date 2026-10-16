-- ArtGuard Hub: require simulated payment before starting service commissions.
-- Run after commission-progress-foundation.sql and commission-payments-foundation.sql.
-- Legacy commissions with service_id IS NULL retain their existing start behavior.

create or replace function public.start_commission(p_commission_id uuid)
returns public.commissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can start commissions'; end if;

  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'ACCEPTED' then raise exception 'Only accepted commissions can be started'; end if;

  if v_commission.service_id is not null then
    if v_commission.amount is null
      or v_commission.amount <= 0
      or v_commission.currency is null
      or v_commission.currency !~ '^[A-Z]{3}$' then
      raise exception 'COMMISSION_PRICE_UNAVAILABLE';
    end if;

    if not exists (
      select 1
      from public.commission_payments p
      where p.commission_id = v_commission.id
        and p.payer_id = v_commission.client_id
        and p.payee_id = v_commission.artist_id
        and p.amount = v_commission.amount
        and p.currency = v_commission.currency
        and p.status = 'PAID'
    ) then
      raise exception 'PAYMENT_REQUIRED_BEFORE_START';
    end if;
  end if;

  update public.commissions
  set status = 'IN_PROGRESS', started_at = now()
  where id = p_commission_id
  returning * into v_commission;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  select
    v_commission.client_id,
    'commission',
    'Commission Started',
    coalesce((select p.name from public.profiles p where p.id = v_user), 'Your artist') || ' has started working on your commission.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text;

  return v_commission;
end;
$$;

revoke all on function public.start_commission(uuid) from public;
grant execute on function public.start_commission(uuid) to authenticated;