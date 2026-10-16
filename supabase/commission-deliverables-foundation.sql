-- ArtGuard Hub: Commission Batch 3B - deliverables foundation
-- Run after commission-progress-foundation.sql and notifications.sql.
-- Originals remain private; deliverables are never added to public portfolios.

create table if not exists public.commission_deliverables (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  original_storage_path text not null unique,
  protected_storage_path text,
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING', 'SUBMITTED', 'FAILED')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_deliverables_title_not_blank check (length(btrim(title)) > 0),
  constraint commission_deliverables_artist_path check (original_storage_path like artist_id::text || '/commissions/' || commission_id::text || '/original/%')
);

create index if not exists commission_deliverables_commission_idx
  on public.commission_deliverables(commission_id, created_at desc);
create index if not exists commission_deliverables_artist_idx
  on public.commission_deliverables(artist_id, created_at desc);

drop trigger if exists commission_deliverables_set_updated_at on public.commission_deliverables;
create trigger commission_deliverables_set_updated_at
before update on public.commission_deliverables
for each row execute function public.set_updated_at();

alter table public.commission_deliverables enable row level security;
revoke all on public.commission_deliverables from authenticated;

drop policy if exists "commission parties can read deliverables" on public.commission_deliverables;
create policy "commission parties can read deliverables"
on public.commission_deliverables for select
to authenticated
using (
  exists (
    select 1 from public.commissions c
    where c.id = commission_deliverables.commission_id
      and (c.artist_id = auth.uid() or (c.client_id = auth.uid() and commission_deliverables.status = 'SUBMITTED'))
  )
);

-- Create a PROCESSING row only for the assigned artist while work is active.
create or replace function public.create_commission_deliverable(
  p_commission_id uuid,
  p_title text,
  p_description text,
  p_original_storage_path text
)
returns public.commission_deliverables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_row public.commission_deliverables;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_title is null then raise exception 'Deliverable title is required'; end if;
  if p_original_storage_path is null or p_original_storage_path not like v_user::text || '/commissions/' || p_commission_id::text || '/original/%' then
    raise exception 'Invalid deliverable storage path';
  end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role <> 'artist' then raise exception 'Only artists can create deliverables'; end if;
  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'IN_PROGRESS' then raise exception 'Commission must be in progress'; end if;

  insert into public.commission_deliverables (commission_id, artist_id, title, description, original_storage_path, status)
  values (p_commission_id, v_user, v_title, v_description, p_original_storage_path, 'PROCESSING')
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_commission_deliverable(uuid, text, text, text) from public;
grant execute on function public.create_commission_deliverable(uuid, text, text, text) to authenticated;

create or replace function public.submit_commission_deliverable(
  p_deliverable_id uuid,
  p_protected_storage_path text
)
returns public.commission_deliverables
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.commission_deliverables;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_protected_storage_path is null or p_protected_storage_path not like v_user::text || '/commissions/' || (select commission_id::text from public.commission_deliverables where id = p_deliverable_id) || '/protected/%' then
    raise exception 'Invalid protected deliverable path';
  end if;
  select * into v_row from public.commission_deliverables where id = p_deliverable_id;
  if v_row.id is null then raise exception 'Deliverable not found'; end if;
  if v_row.artist_id <> v_user then raise exception 'Not authorized for this deliverable'; end if;
  if v_row.status <> 'PROCESSING' then raise exception 'Deliverable is not processing'; end if;

  update public.commission_deliverables
  set protected_storage_path = p_protected_storage_path, status = 'SUBMITTED', submitted_at = now()
  where id = p_deliverable_id
  returning * into v_row;

  insert into public.notifications (recipient_id, notification_type, title, message, related_id, related_route)
  select c.client_id, 'commission', 'New Deliverable Submitted',
    coalesce((select p.name from public.profiles p where p.id = v_user), 'Your artist') || ' submitted a new deliverable for your commission.',
    c.id, '/home/workspace/' || c.id::text
  from public.commissions c where c.id = v_row.commission_id;
  return v_row;
end;
$$;

grant execute on function public.submit_commission_deliverable(uuid, text) to authenticated;
revoke all on function public.submit_commission_deliverable(uuid, text) from public;

create or replace function public.fail_commission_deliverable(p_deliverable_id uuid)
returns public.commission_deliverables
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.commission_deliverables;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_row from public.commission_deliverables where id = p_deliverable_id;
  if v_row.id is null or v_row.artist_id <> auth.uid() then raise exception 'Not authorized for this deliverable'; end if;
  update public.commission_deliverables set status = 'FAILED', protected_storage_path = null where id = p_deliverable_id and status = 'PROCESSING' returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.fail_commission_deliverable(uuid) to authenticated;
revoke all on function public.fail_commission_deliverable(uuid) from public;

-- Safe metadata listing: never returns original paths to clients.
create or replace function public.list_commission_deliverables(p_commission_id uuid)
returns table (id uuid, commission_id uuid, title text, description text, protected_storage_path text, status text, submitted_at timestamptz, created_at timestamptz)
language plpgsql security definer stable set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.commissions c where c.id = p_commission_id and (c.artist_id = auth.uid() or c.client_id = auth.uid())) then raise exception 'Not authorized for this commission'; end if;
  return query select d.id, d.commission_id, d.title, d.description,
    case when d.status = 'SUBMITTED' or exists (select 1 from public.commissions c where c.id = d.commission_id and c.artist_id = auth.uid()) then d.protected_storage_path else null end,
    case when exists (select 1 from public.commissions c where c.id = d.commission_id and c.client_id = auth.uid()) and d.status <> 'SUBMITTED' then 'HIDDEN' else d.status end,
    case when d.status = 'SUBMITTED' then d.submitted_at else null end, d.created_at
  from public.commission_deliverables d where d.commission_id = p_commission_id and (d.status = 'SUBMITTED' or exists (select 1 from public.commissions c where c.id = d.commission_id and c.artist_id = auth.uid())) order by d.created_at desc;
end;
$$;

grant execute on function public.list_commission_deliverables(uuid) to authenticated;
revoke all on function public.list_commission_deliverables(uuid) from public;

drop policy if exists "users can upload their own originals" on storage.objects;
create policy "users can upload their own originals"
on storage.objects for insert
to authenticated
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
        and c.status = 'IN_PROGRESS'
        and name like auth.uid()::text || '/commissions/' || c.id::text || '/original/%'
    )
  )
);

drop policy if exists "artists can upload commission protected derivatives" on storage.objects;
create policy "artists can upload commission protected derivatives"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'artworks'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] = 'commissions'
  and (storage.foldername(name))[4] = 'protected'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'artist'
  )
  and exists (
    select 1
    from public.commissions c
    where c.id::text = (storage.foldername(name))[3]
      and c.artist_id = auth.uid()
      and c.status = 'IN_PROGRESS'
      and name like auth.uid()::text || '/commissions/' || c.id::text || '/protected/%'
  )
);

-- Protected derivative reads are limited to submitted deliverables whose object
-- path exactly matches a stored path. Originals remain owner-folder protected.
create or replace function public.is_submitted_commission_derivative(object_path text)
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from public.commission_deliverables d join public.commissions c on c.id = d.commission_id where d.protected_storage_path = object_path and d.status = 'SUBMITTED' and (c.artist_id = auth.uid() or c.client_id = auth.uid()) and object_path like '%/commissions/%/protected/%'); $$;
grant execute on function public.is_submitted_commission_derivative(text) to authenticated;
drop policy if exists "authorized users can read submitted commission derivatives" on storage.objects;
create policy "authorized users can read submitted commission derivatives" on storage.objects for select to authenticated using (bucket_id = 'artworks' and public.is_submitted_commission_derivative(name));
