-- ArtGuard Hub: Artist-only Protection RLS migration
--
-- Applies only the role restriction to existing policies.
-- Does not create tables, columns, triggers, grants, or storage buckets.
-- Safe to run repeatedly.

-- Artwork records: artists may access only their own artwork records.
drop policy if exists "artwork owners can read their records" on public.artworks;
create policy "artwork owners can read their records"
on public.artworks for select
to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

drop policy if exists "users can create their own artwork records" on public.artworks;
create policy "users can create their own artwork records"
on public.artworks for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

drop policy if exists "artwork owners can update their records" on public.artworks;
create policy "artwork owners can update their records"
on public.artworks for update
to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
)
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

drop policy if exists "artwork owners can delete their records" on public.artworks;
create policy "artwork owners can delete their records"
on public.artworks for delete
to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

-- Persistent protection settings: only artist owners of the artwork may access them.
drop policy if exists "owners can read protection settings" on public.artwork_protection_settings;
create policy "owners can read protection settings"
on public.artwork_protection_settings for select
to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.artworks a
    where a.id = artwork_id
      and a.owner_id = auth.uid()
  )
);

drop policy if exists "owners can create protection settings" on public.artwork_protection_settings;
create policy "owners can create protection settings"
on public.artwork_protection_settings for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.artworks a
    where a.id = artwork_id
      and a.owner_id = auth.uid()
  )
);

drop policy if exists "owners can update protection settings" on public.artwork_protection_settings;
create policy "owners can update protection settings"
on public.artwork_protection_settings for update
to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.artworks a
    where a.id = artwork_id
      and a.owner_id = auth.uid()
  )
)
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.artworks a
    where a.id = artwork_id
      and a.owner_id = auth.uid()
  )
);

-- Protection events: only artist owners may read or create their events.
drop policy if exists "owners can read protection events" on public.protection_events;
create policy "owners can read protection events"
on public.protection_events for select
to authenticated
using (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.artworks a
    where a.id = artwork_id
      and a.owner_id = auth.uid()
  )
);

drop policy if exists "owners can create protection events" on public.protection_events;
create policy "owners can create protection events"
on public.protection_events for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.artworks a
    where a.id = artwork_id
      and a.owner_id = auth.uid()
  )
);

-- Private artworks bucket: preserve the existing owner-folder check and require artist role.
drop policy if exists "artwork owners can read originals" on storage.objects;
create policy "artwork owners can read originals"
on storage.objects for select
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

drop policy if exists "users can upload their own originals" on storage.objects;
create policy "users can upload their own originals"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

drop policy if exists "artwork owners can update originals" on storage.objects;
create policy "artwork owners can update originals"
on storage.objects for update
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
)
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);

drop policy if exists "artwork owners can delete originals" on storage.objects;
create policy "artwork owners can delete originals"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
);
