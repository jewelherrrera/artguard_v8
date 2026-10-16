-- ArtGuard Hub: simulated full refunds for cancelled commissions.
-- Run after commission-payment-cancellation-coordination.sql.
-- This does not contact a payment provider or move real funds.

create or replace function public.simulate_commission_payment_refund(p_payment_id uuid)
returns public.commission_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission_id uuid;
  v_commission public.commissions;
  v_payment public.commission_payments;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'Only client accounts can simulate refunds';
  end if;

  select commission_id into v_commission_id
  from public.commission_payments
  where id = p_payment_id
    and payer_id = v_user;
  if not found then raise exception 'Payment not found or not owned by the current Client'; end if;

  select * into v_commission
  from public.commissions
  where id = v_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;

  select * into v_payment
  from public.commission_payments
  where id = p_payment_id
  for update;
  if not found then raise exception 'Payment not found'; end if;

  if v_payment.commission_id <> v_commission.id
    or v_payment.payer_id <> v_commission.client_id
    or v_payment.payee_id <> v_commission.artist_id
    or v_payment.payer_id <> v_user then
    raise exception 'Payment does not match the commission participants';
  end if;
  if v_commission.status <> 'CANCELLED' then
    raise exception 'Only cancelled commissions can be refunded';
  end if;
  if v_payment.status = 'REFUNDED' then
    return v_payment;
  end if;
  if v_payment.status <> 'PAID' then
    raise exception 'Only paid payments can be refunded';
  end if;

  update public.commission_payments
  set status = 'REFUNDED',
      refunded_amount = v_payment.amount,
      refunded_at = now()
  where id = v_payment.id
    and status = 'PAID'
  returning * into v_payment;
  if not found then raise exception 'Payment is no longer eligible for refund'; end if;

  return v_payment;
end;
$$;

revoke all on function public.simulate_commission_payment_refund(uuid) from public, anon, authenticated;
grant execute on function public.simulate_commission_payment_refund(uuid) to authenticated;