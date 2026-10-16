-- ArtGuard Hub: Commission Batch 3A - real progress foundation
-- Run after commission-request-review.sql and notifications.sql.
-- Preserves existing commission, revision, and notification data.

alter table public.commissions
  add column if not exists started_at timestamptz;

create table if not exists public.commission_progress_updates (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,
  progress_percent integer not null check (progress_percent between 0 and 100),
  note text not null check (length(btrim(note)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists commission_progress_updates_commission_idx
  on public.commission_progress_updates(commission_id, created_at desc);
create index if not exists commission_progress_updates_artist_idx
  on public.commission_progress_updates(artist_id, created_at desc);

alter table public.commission_progress_updates enable row level security;

drop policy if exists "commission parties can read progress" on public.commission_progress_updates;
create policy "commission parties can read progress"
on public.commission_progress_updates for select
to authenticated
using (
  exists (
    select 1
    from public.commissions c
    where c.id = commission_progress_updates.commission_id
      and (c.client_id = auth.uid() or c.artist_id = auth.uid())
  )
);

-- Progress creation and lifecycle changes are RPC-only.
revoke all on public.commission_progress_updates from authenticated;
drop policy if exists "artists can create commission progress" on public.commission_progress_updates;
drop policy if exists "commission parties can update progress" on public.commission_progress_updates;
drop policy if exists "commission parties can delete progress" on public.commission_progress_updates;

create or replace function public.start_commission(p_commission_id uuid)
returns public.commissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can start commissions'; end if;

  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'ACCEPTED' then raise exception 'Only accepted commissions can be started'; end if;

  update public.commissions
  set status = 'IN_PROGRESS', started_at = now()
  where id = p_commission_id
  returning * into v_commission;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  select
    v_commission.client_id,
    'commission',
    'Commission Started',
    coalesce((select p.name from public.profiles p where p.id = v_user), 'Your artist') || ' has started working on your commission.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text;

  return v_commission;
end;
$$;

revoke all on function public.start_commission(uuid) from public;
grant execute on function public.start_commission(uuid) to authenticated;

create or replace function public.create_commission_progress(
  p_commission_id uuid,
  p_progress_percent integer,
  p_note text
)
returns public.commission_progress_updates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_progress public.commission_progress_updates;
  v_note text := nullif(btrim(p_note), '');
  v_artist_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'Progress must be between 0 and 100';
  end if;
  if v_note is null then raise exception 'Progress note is required'; end if;

  select role, name into v_role, v_artist_name from public.profiles where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can post progress'; end if;

  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'IN_PROGRESS' then raise exception 'Commission must be in progress'; end if;

  insert into public.commission_progress_updates (
    commission_id, artist_id, progress_percent, note
  )
  values (
    v_commission.id, v_user, p_progress_percent, v_note
  )
  returning * into v_progress;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.client_id,
    'commission',
    'Commission Progress Updated',
    coalesce(v_artist_name, 'Your artist') || ' posted a new progress update: ' || left(v_note, 120),
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_progress;
end;
$$;

revoke all on function public.create_commission_progress(uuid, integer, text) from public;
grant execute on function public.create_commission_progress(uuid, integer, text) to authenticated;

create or replace function public.list_commission_progress(p_commission_id uuid)
returns table (
  id uuid,
  commission_id uuid,
  progress_percent integer,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.commissions c
    where c.id = p_commission_id
      and (c.client_id = auth.uid() or c.artist_id = auth.uid())
  ) then
    raise exception 'Not authorized for this commission';
  end if;

  return query
  select p.id, p.commission_id, p.progress_percent, p.note, p.created_at
  from public.commission_progress_updates p
  where p.commission_id = p_commission_id
  order by p.created_at desc;
end;
$$;

revoke all on function public.list_commission_progress(uuid) from public;
grant execute on function public.list_commission_progress(uuid) to authenticated;
