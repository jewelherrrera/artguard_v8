-- Symmetric selection for Client- and Artist-owned public commission posts.
-- Run after commission-post-role-symmetry.sql and commission-post-selection.sql.

create or replace function public.select_commission_post_applicant(
  p_commission_post_id uuid,
  p_application_id uuid,
  p_amount numeric,
  p_currency text
)
returns public.commissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_owner_name text;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
  v_applicant_role text;
  v_client_id uuid;
  v_artist_id uuid;
  v_created public.commissions;
begin
  if v_user is null then raise exception 'SELECTION_NOT_AUTHORIZED'; end if;
  select profile.role, profile.name
  into v_role, v_owner_name
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'SELECTION_NOT_AUTHORIZED';
  end if;

  select post.* into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'SELECTION_POST_NOT_FOUND'; end if;
  if v_post.owner_id <> v_user or v_post.owner_role <> v_role then
    raise exception 'SELECTION_NOT_AUTHORIZED';
  end if;
  if v_post.status <> 'OPEN' then raise exception 'SELECTION_POST_NOT_OPEN'; end if;

  select application.* into v_application
  from public.commission_post_applications as application
  where application.id = p_application_id
    and application.commission_post_id = v_post.id
  for update;
  if not found then raise exception 'SELECTION_APPLICATION_NOT_FOUND'; end if;
  if v_application.applicant_role = v_post.owner_role
    or v_application.applicant_role not in ('client', 'artist') then
    raise exception 'SELECTION_APPLICATION_ROLE_INVALID';
  end if;
  if v_application.status <> 'PENDING' then
    raise exception 'SELECTION_APPLICATION_NOT_PENDING';
  end if;

  select profile.role into v_applicant_role
  from public.profiles as profile
  where profile.id = v_application.applicant_id;
  if v_applicant_role is distinct from v_application.applicant_role then
    raise exception 'SELECTION_APPLICATION_ROLE_INVALID';
  end if;

  if p_amount is null or p_amount <= 0
    or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'SELECTION_INVALID_AMOUNT';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'SELECTION_INVALID_AMOUNT_PRECISION';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'SELECTION_INVALID_CURRENCY';
  end if;
  if v_post.currency is not null and p_currency <> v_post.currency then
    raise exception 'SELECTION_CURRENCY_MISMATCH';
  end if;
  if v_post.budget_min is not null and p_amount < v_post.budget_min then
    raise exception 'SELECTION_AMOUNT_BELOW_BUDGET';
  end if;
  if v_post.budget_max is not null and p_amount > v_post.budget_max then
    raise exception 'SELECTION_AMOUNT_ABOVE_BUDGET';
  end if;

  if v_post.owner_role = 'client' then
    v_client_id := v_post.owner_id;
    v_artist_id := v_application.applicant_id;
  else
    v_artist_id := v_post.owner_id;
    v_client_id := v_application.applicant_id;
  end if;

  insert into public.commissions (
    order_ref, client_id, artist_id, title, description, status,
    requested_at, service_id, amount, currency, public_post_id
  )
  values (
    'CM-' || gen_random_uuid()::text,
    v_client_id,
    v_artist_id,
    v_post.title,
    v_post.description,
    'REQUESTED',
    now(),
    null,
    p_amount,
    p_currency,
    v_post.id
  )
  on conflict (public_post_id) where public_post_id is not null do nothing
  returning * into v_created;
  if not found then raise exception 'SELECTION_ALREADY_COMPLETED'; end if;

  update public.commission_post_applications as application
  set status = 'SELECTED'
  where application.id = v_application.id
    and application.commission_post_id = v_post.id
    and application.status = 'PENDING';
  if not found then raise exception 'SELECTION_APPLICATION_NOT_PENDING'; end if;

  update public.commission_post_applications as application
  set status = 'REJECTED'
  where application.commission_post_id = v_post.id
    and application.id <> v_application.id
    and application.status = 'PENDING';

  update public.commission_posts as post
  set status = 'SELECTED'
  where post.id = v_post.id
    and post.owner_id = v_user
    and post.owner_role = v_role
    and post.status = 'OPEN';
  if not found then raise exception 'SELECTION_POST_NOT_OPEN'; end if;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    case when v_post.owner_role = 'client'
      then v_created.artist_id
      else v_created.client_id
    end,
    'commission',
    case when v_post.owner_role = 'client'
      then 'New Commission Request'
      else 'Public Commission Request Selected'
    end,
    coalesce(v_owner_name, 'A user') || ' selected your request for "' || v_post.title || '".',
    v_created.id,
    '/home/workspace/' || v_created.id::text
  );

  return v_created;
end;
$$;

revoke all on function public.select_commission_post_applicant(uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.select_commission_post_applicant(uuid, uuid, numeric, text)
  to authenticated;
