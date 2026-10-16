-- ArtGuard Hub - Batch A: private artwork storage and ownership
-- Run once in Supabase SQL Editor after schema.sql/profile-repair.sql.
-- Originals remain private. Protection derivatives are reserved for later batches.

create extension if not exists "pgcrypto";

create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  original_storage_path text not null unique,
  protected_storage_path text,
  protection_level text not null default 'standard'
    check (protection_level in ('standard', 'enhanced', 'maximum')),
  status text not null default 'original_uploaded'
    check (status in ('original_uploaded', 'processing', 'ready', 'failed')),
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 41943040),
  constraint artworks_original_path_owner check (original_storage_path like owner_id::text || '/%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artworks_owner_created_idx
  on public.artworks(owner_id, created_at desc);

create or replace function public.set_artwork_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists artworks_set_updated_at on public.artworks;
create trigger artworks_set_updated_at
before update on public.artworks
for each row execute function public.set_artwork_updated_at();

alter table public.artworks enable row level security;

drop policy if exists "artwork owners can read their records" on public.artworks;
create policy "artwork owners can read their records"
on public.artworks for select
to authenticated
using (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
));

drop policy if exists "users can create their own artwork records" on public.artworks;
create policy "users can create their own artwork records"
on public.artworks for insert
to authenticated
with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
));

drop policy if exists "artwork owners can update their records" on public.artworks;
create policy "artwork owners can update their records"
on public.artworks for update
to authenticated
using (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
))
with check (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
));

drop policy if exists "artwork owners can delete their records" on public.artworks;
create policy "artwork owners can delete their records"
on public.artworks for delete
to authenticated
using (owner_id = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'
));

grant select, insert, update, delete on public.artworks to authenticated;

-- Private bucket for originals. Do not change this bucket to public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artworks', 'artworks', false, 41943040, array['image/jpeg', 'image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = 41943040,
    allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists "artwork owners can read originals" on storage.objects;
create policy "artwork owners can read originals"
on storage.objects for select
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
);

drop policy if exists "users can upload their own originals" on storage.objects;
create policy "users can upload their own originals"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
);

drop policy if exists "artwork owners can update originals" on storage.objects;
create policy "artwork owners can update originals"
on storage.objects for update
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
)
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
);

drop policy if exists "artwork owners can delete originals" on storage.objects;
create policy "artwork owners can delete originals"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
);
