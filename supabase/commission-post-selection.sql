-- ArtGuard Hub: public commission post selection.
-- Run after notifications.sql, commission-request-foundation.sql,
-- commission-service-request.sql, and commission-posts-foundation.sql.
-- Converts one selected application into one normal commission atomically.

alter table public.commissions
  add column if not exists public_post_id uuid
    references public.commission_posts(id) on delete restrict;

create unique index if not exists commissions_public_post_id_unique
  on public.commissions(public_post_id)
  where public_post_id is not null;

create or replace function public.select_commission_post_artist(
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
  v_client_name text;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
  v_artist_role text;
  v_created public.commissions;
begin
  select * into v_post
  from public.commission_posts
  where id = p_commission_post_id
  for update;
  if not found then raise exception 'Commission post not found'; end if;

  if v_user is null then raise exception 'Not authenticated'; end if;
  select role, name into v_role, v_client_name
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'Only Client accounts can select an Artist';
  end if;
  if v_post.client_id <> v_user then raise exception 'Not authorized to select an Artist for this post'; end if;
  if v_post.status <> 'OPEN' then raise exception 'Commission post is no longer open'; end if;

  select * into v_application
  from public.commission_post_applications
  where id = p_application_id
  for update;
  if not found then raise exception 'Application not found'; end if;
  if v_application.commission_post_id <> v_post.id then
    raise exception 'Application does not belong to this commission post';
  end if;
  if v_application.status <> 'PENDING' then raise exception 'Only pending applications can be selected'; end if;

  select role into v_artist_role
  from public.profiles
  where id = v_application.artist_id;
  if v_artist_role is distinct from 'artist' then raise exception 'The selected account is no longer an Artist'; end if;

  if p_amount is null
    or p_amount <= 0
    or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Final agreed amount must be a finite number greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Final agreed amount cannot have more than two decimal places';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be exactly three uppercase letters';
  end if;
  if v_post.currency is not null and p_currency <> v_post.currency then
    raise exception 'Final currency must match the commission post currency';
  end if;
  if v_post.budget_min is not null and p_amount < v_post.budget_min then
    raise exception 'Final agreed amount is below the post budget minimum';
  end if;
  if v_post.budget_max is not null and p_amount > v_post.budget_max then
    raise exception 'Final agreed amount is above the post budget maximum';
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
    amount,
    currency,
    public_post_id
  )
  values (
    'CM-' || gen_random_uuid()::text,
    v_user,
    v_application.artist_id,
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
  if not found then raise exception 'This commission post has already been selected'; end if;

  update public.commission_post_applications
  set status = 'SELECTED'
  where id = v_application.id
    and commission_post_id = v_post.id
    and status = 'PENDING';
  if not found then raise exception 'Only pending applications can be selected'; end if;

  update public.commission_post_applications
  set status = 'REJECTED'
  where commission_post_id = v_post.id
    and id <> v_application.id
    and status = 'PENDING';

  update public.commission_posts
  set status = 'SELECTED'
  where id = v_post.id
    and client_id = v_user
    and status = 'OPEN';
  if not found then raise exception 'Commission post is no longer open'; end if;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_created.artist_id,
    'commission',
    'New Commission Request',
    coalesce(v_client_name, 'A client') || ' selected your application and sent a commission request for "' || v_post.title || '".',
    v_created.id,
    '/home/workspace/' || v_created.id::text
  );

  return v_created;
end;
$$;

revoke all on function public.select_commission_post_artist(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.select_commission_post_artist(uuid, uuid, numeric, text) to authenticated;
