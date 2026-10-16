-- ArtGuard Hub: one-time Client review editing.
-- Run after artist-reviews-foundation.sql. Reviews remain RPC-only writable.

alter table public.artist_reviews
  add column if not exists edited_at timestamptz null default null;

create or replace function public.update_my_artist_review(
  p_review_id uuid,
  p_rating integer,
  p_review_text text
)
returns public.artist_reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission_id uuid;
  v_commission public.commissions;
  v_review public.artist_reviews;
  v_review_text text := nullif(btrim(p_review_text), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role
  from public.profiles
  where id = v_user;
  if v_role is distinct from 'client' then
    raise exception 'REVIEW_NOT_AUTHORIZED';
  end if;

  select commission_id into v_commission_id
  from public.artist_reviews
  where id = p_review_id;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;

  select * into v_commission
  from public.commissions
  where id = v_commission_id
  for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_commission.client_id <> v_user then
    raise exception 'REVIEW_NOT_AUTHORIZED';
  end if;
  if v_commission.status <> 'COMPLETED' then
    raise exception 'REVIEW_NOT_AUTHORIZED';
  end if;

  select * into v_review
  from public.artist_reviews
  where id = p_review_id
    and commission_id = v_commission.id
  for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.created_at is null
    or v_review.created_at > now()
    or now() > v_review.created_at + interval '7 days' then
    raise exception 'REVIEW_EDIT_WINDOW_EXPIRED';
  end if;
  if v_review.edited_at is not null then
    raise exception 'REVIEW_ALREADY_EDITED';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 or v_review_text is null then
    raise exception 'INVALID_REVIEW';
  end if;

  update public.artist_reviews
  set rating = p_rating,
      review_text = v_review_text,
      edited_at = now()
  where id = v_review.id
    and commission_id = v_commission.id
    and edited_at is null
  returning * into v_review;
  if not found then raise exception 'REVIEW_ALREADY_EDITED'; end if;

  return v_review;
end;
$$;

revoke all on function public.update_my_artist_review(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.update_my_artist_review(uuid, integer, text) to authenticated;

-- Replace the list RPC to expose edited_at to the real Artist Profile.
drop function if exists public.list_artist_reviews(uuid);

create function public.list_artist_reviews(p_artist_id uuid)
returns table (
  review_id uuid,
  commission_id uuid,
  rating integer,
  review_text text,
  created_at timestamptz,
  edited_at timestamptz,
  reviewer_display_name text,
  reviewer_username text,
  reviewer_avatar_data_url text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_artist_id
      and p.role = 'artist'
  ) then
    raise exception 'Artist profile not found';
  end if;

  return query
  select
    r.id,
    r.commission_id,
    r.rating,
    r.review_text,
    r.created_at,
    r.edited_at,
    reviewer.name,
    reviewer.username,
    reviewer.avatar_data_url
  from public.artist_reviews r
  join public.commissions c on c.id = r.commission_id
  join public.profiles reviewer on reviewer.id = c.client_id
  where c.artist_id = p_artist_id
    and c.status = 'COMPLETED'
  order by r.created_at desc;
end;
$$;

revoke all on function public.list_artist_reviews(uuid) from public;
grant execute on function public.list_artist_reviews(uuid) to authenticated;
