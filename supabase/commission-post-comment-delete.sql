-- ArtGuard Hub: authenticated deletion for public commission post comments.
-- Run after commission-post-comments.sql.
-- Direct table deletion remains unavailable to authenticated clients.

revoke delete on table public.commission_post_comments from public, anon, authenticated;

create or replace function public.delete_commission_post_comment(
  p_comment_id uuid
)
returns public.commission_post_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_comment public.commission_post_comments;
  v_deleted public.commission_post_comments;
  v_post_client_id uuid;
begin
  if v_user is null then raise exception 'COMMENT_NOT_AUTHORIZED'; end if;

  select p.role
  into v_role
  from public.profiles as p
  where p.id = v_user;

  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  select c.*
  into v_comment
  from public.commission_post_comments as c
  where c.id = p_comment_id
  for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;

  select post.client_id
  into v_post_client_id
  from public.commission_posts as post
  where post.id = v_comment.commission_post_id
  for share;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;

  if v_comment.author_id <> v_user
    and not (v_role = 'client' and v_post_client_id = v_user) then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  delete from public.commission_post_comments as c
  where c.id = v_comment.id
  returning c.* into v_deleted;

  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  return v_deleted;
end;
$$;

revoke all on function public.delete_commission_post_comment(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_commission_post_comment(uuid)
  to authenticated;
