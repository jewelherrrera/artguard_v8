-- ArtGuard Hub: Commission Batch 3C - client review and deliverable-linked revisions
-- Run after commission-deliverables-foundation.sql.
-- Preserves existing commissions, deliverables, revisions, and notifications.

alter table public.commission_deliverables
  add column if not exists approved_at timestamptz;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.commission_deliverables'::regclass
      and conname = 'commission_deliverables_status_check'
  ) then
    alter table public.commission_deliverables drop constraint commission_deliverables_status_check;
  end if;
  alter table public.commission_deliverables
    add constraint commission_deliverables_status_check
    check (status in ('PROCESSING', 'SUBMITTED', 'APPROVED', 'FAILED'));
end;
$$;

alter table public.revision_requests
  add column if not exists deliverable_id uuid references public.commission_deliverables(id) on delete set null;

drop policy if exists "commission parties can read deliverables" on public.commission_deliverables;
create policy "commission parties can read deliverables"
on public.commission_deliverables for select
to authenticated
using (
  exists (
    select 1 from public.commissions c
    where c.id = commission_deliverables.commission_id
      and (c.artist_id = auth.uid() or (c.client_id = auth.uid() and commission_deliverables.status in ('SUBMITTED', 'APPROVED')))
  )
);

create index if not exists revision_requests_deliverable_idx
  on public.revision_requests(deliverable_id, created_at desc);

-- Existing revision requests remain valid. The optional deliverable argument
-- keeps the legacy commission-only path working.
create or replace function public.create_revision_request(
  p_commission_id uuid,
  p_description text
)
returns public.revision_requests
language plpgsql security definer set search_path = public
as $$
begin
  return public.create_revision_request(p_commission_id, null, p_description);
end;
$$;

create or replace function public.create_revision_request(
  p_commission_id uuid,
  p_deliverable_id uuid,
  p_description text
)
returns public.revision_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_commission public.commissions;
  v_deliverable public.commission_deliverables;
  v_row public.revision_requests;
  v_description text := nullif(btrim(p_description), '');
  v_client_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_description is null then raise exception 'Description cannot be empty'; end if;
  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.client_id <> v_user then raise exception 'Only the client can create a revision request'; end if;

  if p_deliverable_id is not null then
    select * into v_deliverable from public.commission_deliverables where id = p_deliverable_id;
    if v_deliverable.id is null or v_deliverable.commission_id <> p_commission_id then raise exception 'Deliverable does not belong to this commission'; end if;
    if v_deliverable.status <> 'SUBMITTED' then raise exception 'Only submitted deliverables can be revised'; end if;
  end if;

  insert into public.revision_requests (commission_id, deliverable_id, client_id, artist_id, description, status)
  values (p_commission_id, p_deliverable_id, v_commission.client_id, v_commission.artist_id, v_description, 'OPEN')
  returning * into v_row;

  update public.commissions
  set status = 'REVISION_REQUESTED'
  where id = p_commission_id
    and status = 'IN_PROGRESS';

  select name into v_client_name from public.profiles where id = v_user;
  insert into public.notifications (recipient_id, notification_type, title, message, related_id, related_route)
  values (
    v_commission.artist_id, 'commission', 'Revision Requested',
    coalesce(v_client_name, 'The client') || ' requested a revision for your commission deliverable.',
    p_commission_id, '/home/workspace/' || p_commission_id::text
  );
  return v_row;
end;
$$;

grant execute on function public.create_revision_request(uuid, text) to authenticated;
grant execute on function public.create_revision_request(uuid, uuid, text) to authenticated;
revoke all on function public.create_revision_request(uuid, text) from public;
revoke all on function public.create_revision_request(uuid, uuid, text) from public;

create or replace function public.create_commission_deliverable(
  p_commission_id uuid,
  p_title text,
  p_description text,
  p_original_storage_path text
)
returns public.commission_deliverables
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_row public.commission_deliverables;
  v_title text := nullif(btrim(p_title), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_title is null then raise exception 'Deliverable title is required'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role <> 'artist' then raise exception 'Only artists can create deliverables'; end if;
  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null or v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status not in ('IN_PROGRESS', 'REVISION_REQUESTED') then raise exception 'Commission must be in progress or revision requested'; end if;
  if p_original_storage_path is null or p_original_storage_path not like v_user::text || '/commissions/' || p_commission_id::text || '/original/%' then raise exception 'Invalid deliverable storage path'; end if;
  insert into public.commission_deliverables (commission_id, artist_id, title, description, original_storage_path, status)
  values (p_commission_id, v_user, v_title, nullif(btrim(p_description), ''), p_original_storage_path, 'PROCESSING')
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.create_commission_deliverable(uuid, text, text, text) to authenticated;
revoke all on function public.create_commission_deliverable(uuid, text, text, text) from public;

create or replace function public.approve_commission_deliverable(p_deliverable_id uuid)
returns public.commission_deliverables
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_row public.commission_deliverables;
  v_commission public.commissions;
  v_client_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role, name into v_role, v_client_name from public.profiles where id = v_user;
  if v_role <> 'client' then raise exception 'Only clients can approve deliverables'; end if;
  select * into v_row from public.commission_deliverables where id = p_deliverable_id;
  if v_row.id is null then raise exception 'Deliverable not found'; end if;
  select * into v_commission from public.commissions where id = v_row.commission_id;
  if v_commission.client_id <> v_user then raise exception 'Not authorized for this deliverable'; end if;
  if v_row.status <> 'SUBMITTED' then raise exception 'Only submitted deliverables can be approved'; end if;

  update public.commission_deliverables
  set status = 'APPROVED', approved_at = now()
  where id = p_deliverable_id
  returning * into v_row;

  insert into public.notifications (recipient_id, notification_type, title, message, related_id, related_route)
  values (
    v_commission.artist_id, 'commission', 'Deliverable Approved',
    coalesce(v_client_name, 'The client') || ' approved your commission deliverable.',
    v_commission.id, '/home/workspace/' || v_commission.id::text
  );
  return v_row;
end;
$$;

grant execute on function public.approve_commission_deliverable(uuid) to authenticated;
revoke all on function public.approve_commission_deliverable(uuid) from public;

-- Allow the existing upload pipeline to create a new version during revision.
drop policy if exists "users can upload their own originals" on storage.objects;
create policy "users can upload their own originals"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  and (
    (storage.foldername(name))[2] is distinct from 'commissions'
    or exists (
      select 1 from public.commissions c
      where c.id::text = (storage.foldername(name))[3]
        and c.artist_id = auth.uid()
        and c.status in ('IN_PROGRESS', 'REVISION_REQUESTED')
        and name like auth.uid()::text || '/commissions/' || c.id::text || '/original/%'
    )
  )
);

drop policy if exists "artists can upload commission protected derivatives" on storage.objects;
create policy "artists can upload commission protected derivatives"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] = 'commissions'
  and (storage.foldername(name))[4] = 'protected'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  and exists (
    select 1 from public.commissions c
    where c.id::text = (storage.foldername(name))[3]
      and c.artist_id = auth.uid()
      and c.status in ('IN_PROGRESS', 'REVISION_REQUESTED')
      and name like auth.uid()::text || '/commissions/' || c.id::text || '/protected/%'
  )
);

-- Client visibility includes approved deliverables; original paths remain hidden.
create or replace function public.is_submitted_commission_derivative(object_path text)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.commission_deliverables d
    join public.commissions c on c.id = d.commission_id
    where d.protected_storage_path = object_path
      and d.status in ('SUBMITTED', 'APPROVED')
      and (c.artist_id = auth.uid() or c.client_id = auth.uid())
      and object_path like '%/commissions/%/protected/%'
  );
$$;

-- Keep the existing submit function's upload validation, while synchronizing
-- revised submission state and notification atomically.
create or replace function public.submit_commission_deliverable(
  p_deliverable_id uuid,
  p_protected_storage_path text
)
returns public.commission_deliverables
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.commission_deliverables;
  v_commission public.commissions;
  v_artist_name text;
  v_was_revision boolean;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_row from public.commission_deliverables where id = p_deliverable_id;
  if v_row.id is null then raise exception 'Deliverable not found'; end if;
  if v_row.artist_id <> v_user then raise exception 'Not authorized for this deliverable'; end if;
  select * into v_commission from public.commissions where id = v_row.commission_id;
  if v_commission.status not in ('IN_PROGRESS', 'REVISION_REQUESTED') then raise exception 'Commission is not accepting deliverables'; end if;
  if v_row.status <> 'PROCESSING' then raise exception 'Deliverable is not processing'; end if;
  if p_protected_storage_path is null or p_protected_storage_path not like v_user::text || '/commissions/' || v_row.commission_id::text || '/protected/%' then raise exception 'Invalid protected deliverable path'; end if;

  v_was_revision := v_commission.status = 'REVISION_REQUESTED';
  update public.commission_deliverables
  set protected_storage_path = p_protected_storage_path, status = 'SUBMITTED', submitted_at = now()
  where id = p_deliverable_id
  returning * into v_row;

  if v_was_revision then
    update public.commissions set status = 'IN_PROGRESS' where id = v_commission.id;
  end if;

  select name into v_artist_name from public.profiles where id = v_user;
  insert into public.notifications (recipient_id, notification_type, title, message, related_id, related_route)
  values (
    v_commission.client_id, 'commission',
    case when v_was_revision then 'Revised Deliverable Submitted' else 'New Deliverable Submitted' end,
    coalesce(v_artist_name, 'Your artist') || case when v_was_revision then ' submitted a revised deliverable for your commission.' else ' submitted a new deliverable for your commission.' end,
    v_commission.id, '/home/workspace/' || v_commission.id::text
  );
  return v_row;
end;
$$;

grant execute on function public.submit_commission_deliverable(uuid, text) to authenticated;
revoke all on function public.submit_commission_deliverable(uuid, text) from public;

-- Return approved deliverables to clients and keep processing/failed hidden.
create or replace function public.list_commission_deliverables(p_commission_id uuid)
returns table (id uuid, commission_id uuid, title text, description text, protected_storage_path text, status text, submitted_at timestamptz, created_at timestamptz)
language plpgsql security definer stable set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.commissions c where c.id = p_commission_id and (c.artist_id = auth.uid() or c.client_id = auth.uid())) then raise exception 'Not authorized for this commission'; end if;
  return query
  select d.id, d.commission_id, d.title, d.description,
    d.protected_storage_path, d.status, case when d.status in ('SUBMITTED', 'APPROVED') then d.submitted_at else null end, d.created_at
  from public.commission_deliverables d
  where d.commission_id = p_commission_id
    and (d.status in ('SUBMITTED', 'APPROVED') or exists (select 1 from public.commissions c where c.id = d.commission_id and c.artist_id = auth.uid()))
  order by d.created_at desc;
end;
$$;
