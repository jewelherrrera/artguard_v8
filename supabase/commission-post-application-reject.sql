-- Owner-only transition of one pending public-post application to REJECTED.
-- Lock the parent post before the application to match the selection RPC's lock order.

revoke update on table public.commission_post_applications from public, anon, authenticated;

create or replace function public.reject_commission_post_application(
  p_application_id uuid
)
returns public.commission_post_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post_id uuid;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
begin
  if v_user is null then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;

  select p.role
  into v_role
  from public.profiles as p
  where p.id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  select a.commission_post_id
  into v_post_id
  from public.commission_post_applications as a
  where a.id = p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  select p.*
  into v_post
  from public.commission_posts as p
  where p.id = v_post_id
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_post.client_id <> v_user then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  if v_post.status <> 'OPEN' then raise exception 'APPLICATION_POST_NOT_OPEN'; end if;

  select a.*
  into v_application
  from public.commission_post_applications as a
  where a.id = p_application_id
    and a.commission_post_id = v_post.id
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if v_application.status <> 'PENDING' then
    raise exception 'APPLICATION_NOT_PENDING';
  end if;

  update public.commission_post_applications as a
  set status = 'REJECTED'
  where a.id = v_application.id
    and a.commission_post_id = v_post.id
    and a.status = 'PENDING'
  returning a.* into v_application;
  if not found then raise exception 'APPLICATION_NOT_PENDING'; end if;

  return v_application;
end;
$$;

revoke all on function public.reject_commission_post_application(uuid)
  from public, anon, authenticated;
grant execute on function public.reject_commission_post_application(uuid)
  to authenticated;
