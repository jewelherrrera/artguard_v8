-- ArtGuard Hub: Pricing Batch A - Artist commission services
-- Creates the real service foundation without changing commissions or mock data.

create table if not exists public.artist_commission_services (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12, 2) not null,
  currency text not null default 'PHP',
  turnaround_days integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_commission_services_name_not_blank check (length(btrim(name)) > 0),
  constraint artist_commission_services_price_nonnegative check (price >= 0),
  constraint artist_commission_services_turnaround_positive check (turnaround_days > 0),
  constraint artist_commission_services_currency_code check (currency ~ '^[A-Z]{3}$')
);

create index if not exists artist_commission_services_artist_idx
  on public.artist_commission_services(artist_id);
create index if not exists artist_commission_services_active_idx
  on public.artist_commission_services(artist_id, is_active, created_at);
create index if not exists artist_commission_services_created_idx
  on public.artist_commission_services(created_at);

drop trigger if exists artist_commission_services_set_updated_at on public.artist_commission_services;
create trigger artist_commission_services_set_updated_at
before update on public.artist_commission_services
for each row execute function public.set_updated_at();

alter table public.artist_commission_services enable row level security;
revoke all on public.artist_commission_services from public, anon, authenticated;
grant select on public.artist_commission_services to authenticated;

drop policy if exists "users can read active commission services" on public.artist_commission_services;
create policy "users can read active commission services"
on public.artist_commission_services for select
to authenticated
using (is_active = true or artist_id = auth.uid());

create or replace function public.create_artist_commission_service(
  p_name text,
  p_description text,
  p_price numeric,
  p_currency text,
  p_turnaround_days integer
)
returns table (service_id uuid, name text, price numeric, currency text, turnaround_days integer, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_name text := nullif(btrim(p_name), '');
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_row public.artist_commission_services;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can create commission services'; end if;
  if v_name is null then raise exception 'Service name is required'; end if;
  if p_price is null or p_price < 0 then raise exception 'Price must be zero or greater'; end if;
  if p_turnaround_days is null or p_turnaround_days <= 0 then raise exception 'Turnaround must be greater than zero days'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter uppercase code'; end if;

  insert into public.artist_commission_services (artist_id, name, description, price, currency, turnaround_days)
  values (v_user, v_name, nullif(btrim(p_description), ''), p_price, v_currency, p_turnaround_days)
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.price, v_row.currency, v_row.turnaround_days, v_row.is_active;
end;
$$;

create or replace function public.update_artist_commission_service(
  p_service_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_currency text,
  p_turnaround_days integer
)
returns public.artist_commission_services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_name text := nullif(btrim(p_name), '');
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_row public.artist_commission_services;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can update commission services'; end if;
  if v_name is null then raise exception 'Service name is required'; end if;
  if p_price is null or p_price < 0 then raise exception 'Price must be zero or greater'; end if;
  if p_turnaround_days is null or p_turnaround_days <= 0 then raise exception 'Turnaround must be greater than zero days'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter uppercase code'; end if;

  update public.artist_commission_services
  set name = v_name,
      description = nullif(btrim(p_description), ''),
      price = p_price,
      currency = v_currency,
      turnaround_days = p_turnaround_days
  where id = p_service_id and artist_id = v_user
  returning * into v_row;
  if v_row.id is null then raise exception 'Service not found or not owned by the current artist'; end if;
  return v_row;
end;
$$;

create or replace function public.set_artist_commission_service_active(
  p_service_id uuid,
  p_is_active boolean
)
returns public.artist_commission_services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_row public.artist_commission_services;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can change service availability'; end if;

  update public.artist_commission_services
  set is_active = p_is_active
  where id = p_service_id and artist_id = v_user
  returning * into v_row;
  if v_row.id is null then raise exception 'Service not found or not owned by the current artist'; end if;
  return v_row;
end;
$$;

create or replace function public.list_my_artist_commission_services()
returns setof public.artist_commission_services
language plpgsql
security definer stable
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return query
  select s.* from public.artist_commission_services s
  where s.artist_id = auth.uid()
  order by s.created_at asc;
end;
$$;

create or replace function public.list_active_artist_commission_services(p_artist_id uuid)
returns table (id uuid, artist_id uuid, name text, description text, price numeric, currency text, turnaround_days integer)
language plpgsql
security definer stable
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_artist_id and p.role = 'artist') then
    raise exception 'Artist not found';
  end if;
  return query
  select s.id, s.artist_id, s.name, s.description, s.price, s.currency, s.turnaround_days
  from public.artist_commission_services s
  where s.artist_id = p_artist_id and s.is_active = true
  order by s.created_at asc;
end;
$$;

revoke all on function public.create_artist_commission_service(text, text, numeric, text, integer) from public;
revoke all on function public.update_artist_commission_service(uuid, text, text, numeric, text, integer) from public;
revoke all on function public.set_artist_commission_service_active(uuid, boolean) from public;
revoke all on function public.list_my_artist_commission_services() from public;
revoke all on function public.list_active_artist_commission_services(uuid) from public;

grant execute on function public.create_artist_commission_service(text, text, numeric, text, integer) to authenticated;
grant execute on function public.update_artist_commission_service(uuid, text, text, numeric, text, integer) to authenticated;
grant execute on function public.set_artist_commission_service_active(uuid, boolean) to authenticated;
grant execute on function public.list_my_artist_commission_services() to authenticated;
grant execute on function public.list_active_artist_commission_services(uuid) to authenticated;