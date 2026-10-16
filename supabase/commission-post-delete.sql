-- Permanently delete an OPEN public commission post owned by the caller.
-- Run after commission-posts-foundation.sql and commission-post-selection.sql.

revoke delete on table public.commission_posts from public, anon, authenticated;

create or replace function public.delete_commission_post(
  p_commission_post_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_post public.commission_posts;
  v_deleted_id uuid;
begin
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;

  select p.role
  into v_role
  from public.profiles as p
  where p.id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  select p.*
  into v_post
  from public.commission_posts as p
  where p.id = p_commission_post_id
  for update;
  if not found then raise exception 'POST_NOT_FOUND'; end if;
  if v_post.client_id <> v_user then raise exception 'POST_NOT_AUTHORIZED'; end if;
  if v_post.status <> 'OPEN' then raise exception 'POST_NOT_OPEN'; end if;
  if exists (
    select 1
    from public.commissions as commission
    where commission.public_post_id = v_post.id
  ) then
    raise exception 'POST_HAS_COMMISSION';
  end if;

  delete from public.commission_posts as p
  where p.id = v_post.id
    and p.client_id = v_user
    and p.status = 'OPEN'
  returning p.id into v_deleted_id;
  if not found then raise exception 'POST_NOT_OPEN'; end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.delete_commission_post(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_commission_post(uuid)
  to authenticated;
