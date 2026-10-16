-- ArtGuard Hub: simulated commission payment foundation.
-- Run after commission request, service snapshot, and lifecycle migrations.
-- This is a school-project simulation only; it does not verify or move real funds.

create table if not exists public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete cascade,
  payer_id uuid not null references auth.users(id) on delete cascade,
  payee_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  refunded_amount numeric(12, 2)
    check (refunded_amount is null or refunded_amount between 0 and amount),
  created_by uuid not null references auth.users(id) on delete cascade,
  constraint commission_payments_distinct_parties check (payer_id <> payee_id)
);

create index if not exists commission_payments_payer_created_idx
  on public.commission_payments(payer_id, created_at desc);
create index if not exists commission_payments_payee_created_idx
  on public.commission_payments(payee_id, created_at desc);

-- A commission can have prior failed attempts, but at most one pending or paid row.
create unique index if not exists commission_payments_one_active_per_commission_idx
  on public.commission_payments(commission_id)
  where status in ('PENDING', 'PAID');

alter table public.commission_payments enable row level security;
revoke all on table public.commission_payments from public, anon, authenticated;
grant select on table public.commission_payments to authenticated;

drop policy if exists "commission parties can read their payments" on public.commission_payments;
create policy "commission parties can read their payments"
on public.commission_payments for select
to authenticated
using (
  (
    payer_id = auth.uid()
    and exists (
      select 1 from public.commissions c
      where c.id = commission_payments.commission_id
        and c.client_id = auth.uid()
        and c.artist_id = commission_payments.payee_id
    )
  )
  or
  (
    payee_id = auth.uid()
    and exists (
      select 1 from public.commissions c
      where c.id = commission_payments.commission_id
        and c.artist_id = auth.uid()
        and c.client_id = commission_payments.payer_id
    )
  )
);

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

  -- Serialize payment creation for this commission before checking active rows.
  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.client_id <> v_user then
    raise exception 'Only the commission Client can create its payment';
  end if;

  select * into v_payment
  from public.commission_payments
  where commission_id = v_commission.id
    and status in ('PENDING', 'PAID')
  order by created_at desc
  limit 1
  for update;
  if found then return v_payment; end if;

  if v_commission.status <> 'ACCEPTED' then
    raise exception 'Only accepted commissions can be paid';
  end if;
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

-- Simulated success only. This is not a real payment-provider confirmation.
create or replace function public.simulate_commission_payment_success(p_payment_id uuid)
returns public.commission_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_payment public.commission_payments;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'Only client accounts can simulate payment';
  end if;

  select * into v_payment
  from public.commission_payments
  where id = p_payment_id
  for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.payer_id <> v_user then
    raise exception 'Only the payment Client can simulate payment';
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

-- Simulated failure only. No provider request or money movement occurs.
create or replace function public.simulate_commission_payment_failure(p_payment_id uuid)
returns public.commission_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_payment public.commission_payments;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'Only client accounts can simulate payment';
  end if;

  select * into v_payment
  from public.commission_payments
  where id = p_payment_id
  for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.payer_id <> v_user then
    raise exception 'Only the payment Client can simulate payment';
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