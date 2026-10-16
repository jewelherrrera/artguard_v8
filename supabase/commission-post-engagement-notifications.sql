-- Bulk public-post engagement counts and trusted notifications.
-- Run after notifications.sql, commission-posts-foundation.sql,
-- and commission-post-comments.sql.

create or replace function public.list_commission_post_engagement_summaries(
  p_commission_post_ids uuid[]
)
returns table (
  commission_post_id uuid,
  comment_count bigint,
  application_count bigint
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
  if v_user is null then raise exception 'POST_NOT_AUTHORIZED'; end if;

  select p.role
  into v_role
  from public.profiles as p
  where p.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  return query
  with requested_posts as (
    select distinct requested.id
    from unnest(coalesce(p_commission_post_ids, array[]::uuid[])) as requested(id)
  ),
  visible_posts as (
    select post.id
    from public.commission_posts as post
    join requested_posts as requested on requested.id = post.id
    where (v_role = 'client' and post.client_id = v_user)
      or (v_role = 'artist' and post.status = 'OPEN')
  ),
  comment_totals as (
    select comment.commission_post_id, count(*) as total
    from public.commission_post_comments as comment
    join visible_posts as visible on visible.id = comment.commission_post_id
    group by comment.commission_post_id
  ),
  application_totals as (
    select application.commission_post_id, count(*) as total
    from public.commission_post_applications as application
    join visible_posts as visible on visible.id = application.commission_post_id
    group by application.commission_post_id
  )
  select visible.id,
         coalesce(comment_totals.total, 0),
         coalesce(application_totals.total, 0)
  from visible_posts as visible
  left join comment_totals on comment_totals.commission_post_id = visible.id
  left join application_totals on application_totals.commission_post_id = visible.id
  order by visible.id;
end;
$$;

revoke all on function public.list_commission_post_engagement_summaries(uuid[])
  from public, anon, authenticated;
grant execute on function public.list_commission_post_engagement_summaries(uuid[])
  to authenticated;

create or replace function public.create_commission_post_application(
  p_commission_post_id uuid,
  p_message text
)
returns public.commission_post_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_artist_name text;
  v_post public.commission_posts;
  v_application public.commission_post_applications;
  v_message text := nullif(btrim(p_message), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select profile.role, profile.name
  into v_role, v_artist_name
  from public.profiles as profile
  where profile.id = v_user;
  if v_role is distinct from 'artist' then raise exception 'Only artist accounts can apply to commission posts'; end if;
  if v_message is null then raise exception 'Application message is required'; end if;

  select post.*
  into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'Commission post not found'; end if;
  if v_post.status <> 'OPEN' then raise exception 'Commission post is not open'; end if;
  if v_post.client_id = v_user then raise exception 'Artists cannot apply to their own commission post'; end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = v_user and profile.role = 'artist'
  ) then
    raise exception 'Artist profile not found';
  end if;
  if exists (
    select 1 from public.commission_post_applications as application
    where application.commission_post_id = v_post.id
      and application.artist_id = v_user
  ) then
    raise exception 'You have already applied to this commission post';
  end if;

  begin
    insert into public.commission_post_applications (
      commission_post_id, artist_id, message, status
    )
    values (v_post.id, v_user, v_message, 'PENDING')
    returning * into v_application;
  exception when unique_violation then
    raise exception 'You have already applied to this commission post';
  end;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_post.client_id,
    'commission',
    'New Public Commission Request',
    coalesce(v_artist_name, 'An Artist') || ' submitted a commission request for your post "' || v_post.title || '".',
    v_post.id,
    '/market'
  );

  return v_application;
end;
$$;

revoke all on function public.create_commission_post_application(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_commission_post_application(uuid, text)
  to authenticated;

create or replace function public.create_commission_post_comment(
  p_commission_post_id uuid,
  p_body text
)
returns table (
  id uuid,
  commission_post_id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  author_avatar_data_url text,
  author_role text,
  body text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_author_name text;
  v_post public.commission_posts;
  v_comment public.commission_post_comments;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_user is null then raise exception 'COMMENT_NOT_AUTHORIZED'; end if;

  select profile.role, profile.name
  into v_role, v_author_name
  from public.profiles as profile
  where profile.id = v_user;
  if v_role not in ('client', 'artist') or v_role is null then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  select post.*
  into v_post
  from public.commission_posts as post
  where post.id = p_commission_post_id
  for update;
  if not found then raise exception 'COMMENT_POST_NOT_FOUND'; end if;
  if v_post.status <> 'OPEN' then raise exception 'COMMENT_POST_NOT_OPEN'; end if;

  if v_role = 'client' and v_post.client_id <> v_user then
    raise exception 'COMMENT_NOT_AUTHORIZED';
  end if;

  if v_body = '' then raise exception 'COMMENT_INVALID_BODY'; end if;
  if char_length(v_body) > 2000 then raise exception 'COMMENT_TOO_LONG'; end if;

  insert into public.commission_post_comments (
    commission_post_id,
    author_id,
    body
  )
  values (
    v_post.id,
    v_user,
    v_body
  )
  returning * into v_comment;

  if v_post.client_id <> v_user then
    insert into public.notifications (
      recipient_id, notification_type, title, message, related_id, related_route
    )
    values (
      v_post.client_id,
      'commission',
      'New Commission Post Comment',
      coalesce(v_author_name, 'A user') || ' commented on your commission post "' || v_post.title || '".',
      v_post.id,
      '/market'
    );
  end if;

  return query
  select
    comment.id,
    comment.commission_post_id,
    comment.author_id,
    author.name,
    author.username,
    author.avatar_data_url,
    author.role,
    comment.body,
    comment.created_at,
    comment.updated_at
  from public.commission_post_comments as comment
  join public.profiles as author on author.id = comment.author_id
  where comment.id = v_comment.id;
end;
$$;

revoke all on function public.create_commission_post_comment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_commission_post_comment(uuid, text)
  to authenticated;
