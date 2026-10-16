-- ArtGuard Hub: Marketplace Batch D1 - real artist service summaries

create or replace function public.list_marketplace_artist_service_summaries()
returns table (
  artist_id uuid,
  active_service_count bigint,
  minimum_price numeric,
  minimum_price_currency text,
  currencies text[],
  has_multiple_currencies boolean,
  minimum_turnaround_days integer
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
    s.artist_id,
    count(*)::bigint as active_service_count,
    min(s.price) as minimum_price,
    (array_agg(s.currency order by s.price, s.created_at, s.id))[1] as minimum_price_currency,
    array_agg(distinct s.currency order by s.currency) as currencies,
    count(distinct s.currency) > 1 as has_multiple_currencies,
    min(s.turnaround_days) as minimum_turnaround_days
  from public.artist_commission_services s
  join public.profiles p on p.id = s.artist_id
  where s.is_active = true
    and p.role = 'artist'
  group by s.artist_id;
end;
$$;

revoke all on function public.list_marketplace_artist_service_summaries() from public;
grant execute on function public.list_marketplace_artist_service_summaries() to authenticated;
