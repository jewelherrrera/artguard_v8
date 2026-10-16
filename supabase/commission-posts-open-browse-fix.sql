-- Forward-only fix for public commission post browsing and application lookup.
-- This keeps authenticated access for both client and artist roles while preserving
-- legacy client_id compatibility for older rows.

DROP FUNCTION IF EXISTS public.list_open_commission_posts();

CREATE FUNCTION public.list_open_commission_posts()
RETURNS TABLE (
  id uuid,
  client_id uuid,
  owner_id uuid,
  owner_role text,
  title text,
  description text,
  budget_min numeric,
  budget_max numeric,
  currency text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  owner_name text,
  owner_username text,
  owner_avatar_data_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
      and profile.role in ('client', 'artist')
  ) then
    raise exception 'POST_NOT_AUTHORIZED';
  end if;

  return query
  select
    post.id,
    post.client_id,
    coalesce(post.owner_id, post.client_id) as owner_id,
    coalesce(
      post.owner_role,
      case
        when coalesce(post.owner_id, post.client_id) = post.client_id then 'client'
        else 'artist'
      end
    ) as owner_role,
    post.title,
    post.description,
    post.budget_min,
    post.budget_max,
    post.currency,
    post.status,
    post.created_at,
    post.updated_at,
    owner_profile.name,
    owner_profile.username,
    owner_profile.avatar_data_url
  from public.commission_posts as post
  join public.profiles as owner_profile
    on owner_profile.id = coalesce(post.owner_id, post.client_id)
  where post.status = 'OPEN'
  order by post.created_at desc;
end;
$$;

REVOKE ALL ON FUNCTION public.list_open_commission_posts() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_commission_posts() TO authenticated;

DROP FUNCTION IF EXISTS public.list_my_commission_post_applications();

CREATE FUNCTION public.list_my_commission_post_applications()
RETURNS TABLE (
  id uuid,
  commission_post_id uuid,
  applicant_id uuid,
  applicant_role text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
      and profile.role in ('client', 'artist')
  ) then
    raise exception 'APPLICATION_NOT_AUTHORIZED';
  end if;

  return query
  select
    application.id,
    application.commission_post_id,
    coalesce(application.applicant_id, application.artist_id) as applicant_id,
    coalesce(
      application.applicant_role,
      case
        when application.artist_id = v_user then 'artist'
        else 'client'
      end
    ) as applicant_role,
    application.status,
    application.created_at
  from public.commission_post_applications as application
  where coalesce(application.applicant_id, application.artist_id) = v_user
  order by application.created_at desc;
end;
$$;

REVOKE ALL ON FUNCTION public.list_my_commission_post_applications() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_commission_post_applications() TO authenticated;
