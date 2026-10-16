-- Keep public-post provenance and paid-before-start checks valid for both
-- Client-owned and Artist-owned public-post commissions.
-- Run after commission-post-role-symmetry.sql, commission-post-symmetric-selection.sql,
-- and commission-start-public-post-payment-guard.sql.

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
  v_post_owner_id uuid;
  v_post_owner_role text;
  v_paid_payment_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role is distinct from 'artist' then
    raise exception 'Only artists can start commissions';
  end if;

  select commission.* into v_commission
  from public.commissions as commission
  where commission.id = p_commission_id
  for update;
  if not found then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'ACCEPTED' then raise exception 'Only accepted commissions can be started'; end if;

  if v_commission.public_post_id is not null then
    select post.owner_id, post.owner_role
    into v_post_owner_id, v_post_owner_role
    from public.commission_posts as post
    where post.id = v_commission.public_post_id
    for share;
    if not found then raise exception 'PUBLIC_POST_PROVENANCE_MISMATCH'; end if;

    if v_post_owner_role = 'client' and not exists (
      select 1
      from public.commission_post_applications as application
      where application.commission_post_id = v_commission.public_post_id
        and application.applicant_id = v_commission.artist_id
        and application.applicant_role = 'artist'
        and application.status = 'SELECTED'
        and v_commission.client_id = v_post_owner_id
    ) then
      raise exception 'PUBLIC_POST_PROVENANCE_MISMATCH';
    elsif v_post_owner_role = 'artist' and not exists (
      select 1
      from public.commission_post_applications as application
      where application.commission_post_id = v_commission.public_post_id
        and application.applicant_id = v_commission.client_id
        and application.applicant_role = 'client'
        and application.status = 'SELECTED'
        and v_commission.artist_id = v_post_owner_id
    ) then
      raise exception 'PUBLIC_POST_PROVENANCE_MISMATCH';
    elsif v_post_owner_role not in ('client', 'artist') then
      raise exception 'PUBLIC_POST_PROVENANCE_MISMATCH';
    end if;
  end if;

  if v_commission.service_id is not null or v_commission.public_post_id is not null then
    if v_commission.amount is null
      or v_commission.amount <= 0
      or v_commission.amount::text in ('NaN', 'Infinity', '-Infinity')
      or v_commission.currency is null
      or v_commission.currency !~ '^[A-Z]{3}$' then
      raise exception 'COMMISSION_PRICE_UNAVAILABLE';
    end if;

    select payment.id into v_paid_payment_id
    from public.commission_payments as payment
    where payment.commission_id = v_commission.id
      and payment.payer_id = v_commission.client_id
      and payment.payee_id = v_commission.artist_id
      and payment.amount = v_commission.amount
      and payment.currency = v_commission.currency
      and payment.status = 'PAID'
    for share;
    if not found then raise exception 'PAYMENT_REQUIRED_BEFORE_START'; end if;
  end if;

  update public.commissions as commission
  set status = 'IN_PROGRESS', started_at = now()
  where commission.id = p_commission_id
  returning commission.* into v_commission;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  select
    v_commission.client_id,
    'commission',
    'Commission Started',
    coalesce((select profile.name from public.profiles as profile where profile.id = v_user), 'Your artist') || ' has started working on your commission.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text;

  return v_commission;
end;
$$;

revoke all on function public.start_commission(uuid)
  from public, anon, authenticated;
grant execute on function public.start_commission(uuid)
  to authenticated;
