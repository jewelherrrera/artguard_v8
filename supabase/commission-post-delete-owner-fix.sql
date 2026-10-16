-- Forward-only replacement for the public commission post delete RPC.
-- Run after commission-post-role-symmetry.sql.
-- Legacy rows without owner_id use client_id as their owner, matching the
-- existing browse compatibility rule that treats those rows as client-owned.

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
  if v_user is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  select post.*
  into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then
    raise exception 'POST_NOT_FOUND';
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_user;
  if v_role is null or v_role not in ('client', 'artist') then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  if v_post.owner_id is null then
    if v_post.client_id <> v_user or v_role <> 'client'
      or (v_post.owner_role is not null and v_post.owner_role <> 'client') then
      raise exception 'POST_NOT_AUTHORIZED';
    end if;
  elsif v_post.owner_id <> v_user
    or (v_post.owner_role is not null and v_post.owner_role <> v_role) then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  if v_post.status <> 'OPEN' then
    raise exception 'POST_NOT_OPEN';
  end if;

  if exists (
    select 1
    from public.commissions as commission
    where commission.public_post_id = v_post.id
  ) then
    raise exception 'POST_HAS_COMMISSION';
  end if;

  delete from public.commission_posts as post
  where post.id = v_post.id
    and post.status = 'OPEN'
    and coalesce(post.owner_id, post.client_id) = v_user
  returning post.id into v_deleted_id;
  if not found then
    raise exception 'POST_NOT_OPEN';
  end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.delete_commission_post(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_commission_post(uuid)
  to authenticated;
