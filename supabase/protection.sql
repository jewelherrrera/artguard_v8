-- ArtGuard Hub - Batch 1: persistent protection settings and events
-- Run after artworks.sql. Safe to re-run.

create table if not exists public.artwork_protection_settings (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  dynamic_cloaking boolean not null default false,
  canvas_tiling boolean not null default false,
  right_click_shield boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artwork_protection_settings_artwork_owner_unique unique (artwork_id)
);

create index if not exists artwork_protection_settings_owner_idx
  on public.artwork_protection_settings(owner_id);

create table if not exists public.protection_events (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists protection_events_owner_created_idx
  on public.protection_events(owner_id, created_at desc);
create index if not exists protection_events_artwork_created_idx
  on public.protection_events(artwork_id, created_at desc);
create index if not exists protection_events_owner_type_created_idx
  on public.protection_events(owner_id, event_type, created_at desc);

create or replace function public.set_protection_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists artwork_protection_settings_set_updated_at on public.artwork_protection_settings;
create trigger artwork_protection_settings_set_updated_at
before update on public.artwork_protection_settings
for each row execute function public.set_protection_settings_updated_at();

alter table public.artwork_protection_settings enable row level security;
alter table public.protection_events enable row level security;

drop policy if exists "owners can read protection settings" on public.artwork_protection_settings;
create policy "owners can read protection settings"
on public.artwork_protection_settings for select
to authenticated
using (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
) and exists (
  select 1 from public.artworks a where a.id = artwork_id and a.owner_id = auth.uid()
));

drop policy if exists "owners can create protection settings" on public.artwork_protection_settings;
create policy "owners can create protection settings"
on public.artwork_protection_settings for insert
to authenticated
with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
) and exists (
  select 1 from public.artworks a where a.id = artwork_id and a.owner_id = auth.uid()
));

drop policy if exists "owners can update protection settings" on public.artwork_protection_settings;
create policy "owners can update protection settings"
on public.artwork_protection_settings for update
to authenticated
using (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
) and exists (
  select 1 from public.artworks a where a.id = artwork_id and a.owner_id = auth.uid()
))
with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
) and exists (
  select 1 from public.artworks a where a.id = artwork_id and a.owner_id = auth.uid()
));

drop policy if exists "owners can read protection events" on public.protection_events;
create policy "owners can read protection events"
on public.protection_events for select
to authenticated
using (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
) and exists (
  select 1 from public.artworks a where a.id = artwork_id and a.owner_id = auth.uid()
));

drop policy if exists "owners can create protection events" on public.protection_events;
create policy "owners can create protection events"
on public.protection_events for insert
to authenticated
with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
) and exists (
  select 1 from public.artworks a where a.id = artwork_id and a.owner_id = auth.uid()
));

grant select, insert, update on public.artwork_protection_settings to authenticated;
grant select, insert on public.protection_events to authenticated;