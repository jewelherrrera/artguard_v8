-- ArtGuard Hub: real artist reviews and ratings foundation
-- Run after commissions and notifications have been created.
-- Reviews are immutable and writable only through the authenticated RPC.

create table if not exists public.artist_reviews (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  review_text text not null,
  created_at timestamptz not null default now(),
  constraint artist_reviews_review_text_not_blank check (length(btrim(review_text)) > 0),
  constraint artist_reviews_commission_id_unique unique (commission_id)
);

create index if not exists commissions_artist_status_id_idx
  on public.commissions(artist_id, status, id);

alter table public.artist_reviews enable row level security;
revoke all on public.artist_reviews from public, anon, authenticated;

create or replace function public.submit_artist_review(
  p_commission_id uuid,
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
  v_commission public.commissions;
  v_review public.artist_reviews;
  v_client_name text;
  v_review_text text := nullif(btrim(p_review_text), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, name into v_role, v_client_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Client profile not found'; end if;
  if v_role <> 'client' then raise exception 'Only clients can submit artist reviews'; end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if v_review_text is null then raise exception 'Review text cannot be empty'; end if;

  select * into v_commission
  from public.commissions
  where id = p_commission_id
  for update;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.client_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'COMPLETED' then raise exception 'Only completed commissions can be reviewed'; end if;
  if v_commission.artist_id = v_user then raise exception 'Clients cannot review themselves'; end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = v_commission.artist_id
      and p.role = 'artist'
  ) then
    raise exception 'Commission artist profile is not valid';
  end if;
  if exists (
    select 1 from public.artist_reviews r
    where r.commission_id = v_commission.id
  ) then
    raise exception 'This commission already has a review';
  end if;

  insert into public.artist_reviews (commission_id, rating, review_text)
  values (v_commission.id, p_rating, v_review_text)
  returning * into v_review;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.artist_id,
    'review',
    'New Artist Review',
    coalesce(v_client_name, 'A client') || ' left a review for your completed commission.',
    v_commission.id,
    '/market/artist/' || v_commission.artist_id::text
  );

  return v_review;
end;
$$;

revoke all on function public.submit_artist_review(uuid, integer, text) from public;
grant execute on function public.submit_artist_review(uuid, integer, text) to authenticated;

create or replace function public.list_artist_reviews(p_artist_id uuid)
returns table (
  review_id uuid,
  commission_id uuid,
  rating integer,
  review_text text,
  created_at timestamptz,
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