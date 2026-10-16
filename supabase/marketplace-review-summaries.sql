-- Public aggregate review summaries for real Marketplace artist cards.
-- Run after artist-reviews-foundation.sql.

create or replace function public.list_marketplace_artist_review_summaries()
returns table (
  artist_id uuid,
  review_count bigint,
  average_rating numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  return query
  select
    c.artist_id,
    count(r.id),
    avg(r.rating)::numeric
  from public.artist_reviews r
  join public.commissions c on c.id = r.commission_id
  join public.profiles artist on artist.id = c.artist_id
  where c.status = 'COMPLETED'
    and artist.role = 'artist'
    and r.rating between 1 and 5
  group by c.artist_id;
end;
$$;

revoke all on function public.list_marketplace_artist_review_summaries() from public, anon, authenticated;
grant execute on function public.list_marketplace_artist_review_summaries() to authenticated;