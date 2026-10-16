-- ArtGuard Hub: Batch 3A admin protected-artwork preview
-- Run after artist-verification-admin-review.sql.
-- Admin storage access is limited to protected derivative paths only.

create or replace function public.list_pending_artist_verifications()
returns table (
  artist_id uuid,
  artist_name text,
  username text,
  bio text,
  interests text[],
  artist_verification_status text,
  artist_verification_submitted_at timestamptz,
  artwork_references jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select p.is_admin into v_is_admin
  from public.profiles p
  where p.id = auth.uid();

  if auth.uid() is null or coalesce(v_is_admin, false) is not true then
    raise exception 'Admin access required';
  end if;

  return query
  select
    p.id,
    p.name,
    p.username,
    p.bio,
    p.interests,
    p.artist_verification_status,
    p.artist_verification_submitted_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'original_filename', a.original_filename,
          'status', a.status,
          'protected_storage_path', a.protected_storage_path,
          'created_at', a.created_at
        ) order by a.created_at desc)
        from public.artworks a
        where a.owner_id = p.id
      ),
      '[]'::jsonb
    )
  from public.profiles p
  where p.role = 'artist'
    and p.artist_verification_status = 'pending'
  order by p.artist_verification_submitted_at asc nulls last;
end;
$$;

drop policy if exists "admins can read protected verification previews" on storage.objects;
create policy "admins can read protected verification previews"
on storage.objects for select
to authenticated
using (
  bucket_id = 'artworks'
  and (storage.foldername(name))[2] = 'protected'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  )
);
