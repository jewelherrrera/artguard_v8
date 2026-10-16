-- ArtGuard Hub: coordinate commission cancellation with simulated payments.
-- Run after commission-cancellation.sql and commission-payments-foundation.sql.
-- Commission and payment lifecycles remain separate; no refunds are performed.

alter table public.commission_payments
  add column if not exists voided_at timestamptz;

alter table public.commission_payments
  drop constraint if exists commission_payments_status_check;

alter table public.commission_payments
  add constraint commission_payments_status_check
  check (status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'VOIDED'));

update public.commission_payments p
set status = 'VOIDED',
    voided_at = coalesce(p.voided_at, now())
where p.status = 'PENDING'
  and exists (
    select 1
    from public.commissions c
    where c.id = p.commission_id
      and c.client_id = p.payer_id
      and c.artist_id = p.payee_id
      and c.status = 'CANCELLED'
  );

create or replace function public.cancel_commission(
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
  v_reason text := nullif(btrim(p_reason), '');
  v_actor_name text;
  v_recipient uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_reason is null then raise exception 'Cancellation reason is required'; end if;

  select role, name into v_role, v_actor_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Profile not found'; end if;

  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if v_commission.id is null then raise exception 'Commission not found'; end if;

  if v_user = v_commission.client_id then
    if v_role <> 'client' then raise exception 'Caller role does not match the commission client'; end if;
    if v_commission.status not in ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED') then
      raise exception 'Commission cannot be cancelled in its current state';
    end if;
    v_recipient := v_commission.artist_id;
  elsif v_user = v_commission.artist_id then
    if v_role <> 'artist' then raise exception 'Caller role does not match the commission artist'; end if;
    if v_commission.status not in ('ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED') then
      raise exception 'Commission cannot be cancelled in its current state';
    end if;
    v_recipient := v_commission.client_id;
  else
    raise exception 'Not authorized for this commission';
  end if;

  update public.commissions
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = v_user,
      cancellation_reason = v_reason
  where id = v_commission.id
    and status <> 'CANCELLED'
  returning * into v_commission;

  if v_commission.id is null then raise exception 'Commission was already cancelled'; end if;

  update public.commission_payments
  set status = 'VOIDED',
      voided_at = now()
  where commission_id = v_commission.id
    and payer_id = v_commission.client_id
    and payee_id = v_commission.artist_id
    and status = 'PENDING';

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_recipient,
    'commission',
    'Commission Cancelled',
    coalesce(v_actor_name, case when v_role = 'client' then 'The client' else 'The artist' end)
      || ' cancelled the commission "' || v_commission.title || '".',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_commission;
end;
$$;

revoke all on function public.cancel_commission(uuid, text) from public;
grant execute on function public.cancel_commission(uuid, text) to authenticated;

create or replace function public.create_commission_payment(p_commission_id uuid)
returns public.commission_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_payment public.commission_payments;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'Only client accounts can create commission payments';
  end if;

  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.client_id <> v_user then
    raise exception 'Only the commission Client can create its payment';
  end if;
  if v_commission.status = 'CANCELLED' then
    raise exception 'COMMISSION_CANCELLED';
  end if;
  if v_commission.status <> 'ACCEPTED' then
    raise exception 'Only accepted commissions can be paid';
  end if;

  select * into v_payment
  from public.commission_payments
  where commission_id = v_commission.id
    and payer_id = v_commission.client_id
    and payee_id = v_commission.artist_id
    and status in ('PENDING', 'PAID')
  order by created_at desc
  limit 1
  for update;
  if found then return v_payment; end if;

  if v_commission.amount is null
    or v_commission.amount <= 0
    or v_commission.currency is null
    or v_commission.currency !~ '^[A-Z]{3}$' then
    raise exception 'COMMISSION_PRICE_UNAVAILABLE';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_commission.artist_id and p.role = 'artist'
  ) then
    raise exception 'Commission Artist not found';
  end if;

  insert into public.commission_payments (
    commission_id,
    payer_id,
    payee_id,
    amount,
    currency,
    status,
    created_by
  )
  values (
    v_commission.id,
    v_commission.client_id,
    v_commission.artist_id,
    v_commission.amount,
    v_commission.currency,
    'PENDING',
    v_user
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

create or replace function public.simulate_commission_payment_success(p_payment_id uuid)
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
    raise exception 'Only client accounts can simulate payment';
  end if;

  select commission_id into v_commission_id
  from public.commission_payments
  where id = p_payment_id and payer_id = v_user;
  if not found then raise exception 'Payment not found or not owned by the current Client'; end if;

  select * into v_commission
  from public.commissions
  where id = v_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.status = 'CANCELLED' then raise exception 'COMMISSION_CANCELLED'; end if;
  if v_commission.status <> 'ACCEPTED' then raise exception 'Only accepted commissions can be paid'; end if;

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
  if v_payment.status <> 'PENDING' then
    raise exception 'Only pending payments can be simulated as successful';
  end if;

  update public.commission_payments
  set status = 'PAID', paid_at = now()
  where id = v_payment.id and status = 'PENDING'
  returning * into v_payment;
  if not found then raise exception 'Payment is no longer pending'; end if;

  return v_payment;
end;
$$;

create or replace function public.simulate_commission_payment_failure(p_payment_id uuid)
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
    raise exception 'Only client accounts can simulate payment';
  end if;

  select commission_id into v_commission_id
  from public.commission_payments
  where id = p_payment_id and payer_id = v_user;
  if not found then raise exception 'Payment not found or not owned by the current Client'; end if;

  select * into v_commission
  from public.commissions
  where id = v_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.status = 'CANCELLED' then raise exception 'COMMISSION_CANCELLED'; end if;
  if v_commission.status <> 'ACCEPTED' then raise exception 'Only accepted commissions can be paid'; end if;

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
  if v_payment.status <> 'PENDING' then
    raise exception 'Only pending payments can be simulated as failed';
  end if;

  update public.commission_payments
  set status = 'FAILED'
  where id = v_payment.id and status = 'PENDING'
  returning * into v_payment;
  if not found then raise exception 'Payment is no longer pending'; end if;

  return v_payment;
end;
$$;

revoke all on function public.create_commission_payment(uuid) from public, anon, authenticated;
revoke all on function public.simulate_commission_payment_success(uuid) from public, anon, authenticated;
revoke all on function public.simulate_commission_payment_failure(uuid) from public, anon, authenticated;
grant execute on function public.create_commission_payment(uuid) to authenticated;
grant execute on function public.simulate_commission_payment_success(uuid) to authenticated;
grant execute on function public.simulate_commission_payment_failure(uuid) to authenticated;