-- ArtGuard Hub: qualify profile references in the open commission post listing RPC.
-- Forward-only fix for list_open_commission_posts() from commission-posts-foundation.sql.

create or replace function public.list_open_commission_posts()
returns table (
  id uuid,
  client_id uuid,
  title text,
  description text,
  budget_min numeric,
  budget_max numeric,
  currency text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select p.role
  into v_role
  from public.profiles as p
  where p.id = v_user;

  if v_role is distinct from 'artist' then
    raise exception 'Only artist accounts can browse commission posts';
  end if;

  return query
  select
    post.id,
    post.client_id,
    post.title,
    post.description,
    post.budget_min,
    post.budget_max,
    post.currency,
    post.created_at,
    post.updated_at
  from public.commission_posts as post
  where post.status = 'OPEN'
  order by post.created_at desc;
end;
$$;

revoke all on function public.list_open_commission_posts()
  from public, anon, authenticated;
grant execute on function public.list_open_commission_posts()
  to authenticated;
