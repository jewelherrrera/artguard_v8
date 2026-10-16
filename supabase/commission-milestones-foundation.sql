-- ArtGuard Hub: Milestone Batch A - real commission milestone foundation
-- Run after commission-progress-foundation.sql.
-- Preserves existing commission and workflow data.

-- If an earlier partial run created the table with the old identifier, repair
-- only that table before the idempotent definition below.
do $$
begin
  if to_regclass('public.commission_milestones') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'commission_milestones'
         and column_name = 'position'
     )
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'commission_milestones'
         and column_name = 'sort_order'
     ) then
    alter table public.commission_milestones rename column position to sort_order;
  end if;
end;
$$;

create table if not exists public.commission_milestones (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null check (sort_order >= 1),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED')),
  started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_milestones_name_not_blank check (length(btrim(name)) > 0),
  constraint commission_milestones_sort_order_unique unique (commission_id, sort_order)
);

do $$
begin
  if to_regclass('public.commission_milestones') is not null
     and exists (
       select 1 from pg_constraint
       where conrelid = 'public.commission_milestones'::regclass
         and conname = 'commission_milestones_position_unique'
     )
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.commission_milestones'::regclass
         and conname = 'commission_milestones_sort_order_unique'
     ) then
    alter table public.commission_milestones
      rename constraint commission_milestones_position_unique to commission_milestones_sort_order_unique;
  end if;
  if to_regclass('public.commission_milestones') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.commission_milestones'::regclass
         and conname = 'commission_milestones_sort_order_unique'
     ) then
    alter table public.commission_milestones
      add constraint commission_milestones_sort_order_unique unique (commission_id, sort_order);
  end if;
end;
$$;

create index if not exists commission_milestones_commission_idx
  on public.commission_milestones(commission_id, sort_order);

create index if not exists commission_milestones_status_idx
  on public.commission_milestones(commission_id, status);

drop trigger if exists commission_milestones_set_updated_at on public.commission_milestones;
create trigger commission_milestones_set_updated_at
before update on public.commission_milestones
for each row execute function public.set_updated_at();

alter table public.commission_milestones enable row level security;
revoke all on public.commission_milestones from authenticated;

drop policy if exists "commission parties can read milestones" on public.commission_milestones;
create policy "commission parties can read milestones"
on public.commission_milestones for select
to authenticated
using (
  exists (
    select 1 from public.commissions c
    where c.id = commission_milestones.commission_id
      and (c.client_id = auth.uid() or c.artist_id = auth.uid())
  )
);

create or replace function public.create_default_commission_milestones(p_commission_id uuid)
returns setof public.commission_milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_count integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role <> 'artist' then raise exception 'Only artists can create milestones'; end if;
  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status not in ('ACCEPTED', 'IN_PROGRESS') then raise exception 'Commission is not ready for milestones'; end if;

  select count(*) into v_count from public.commission_milestones where commission_id = p_commission_id;
  if v_count = 0 then
    insert into public.commission_milestones (commission_id, name, sort_order)
    values
      (p_commission_id, 'Thumbnail', 1),
      (p_commission_id, 'Sketch', 2),
      (p_commission_id, 'Line Art', 3),
      (p_commission_id, 'Final Render', 4);
  end if;

  return query
  select * from public.commission_milestones
  where commission_id = p_commission_id
  order by sort_order asc;
end;
$$;

revoke all on function public.create_default_commission_milestones(uuid) from public;
grant execute on function public.create_default_commission_milestones(uuid) to authenticated;

create or replace function public.list_commission_milestones(p_commission_id uuid)
returns table (
  id uuid,
  commission_id uuid,
  name text,
  description text,
  sort_order integer,
  status text,
  started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  note text,
  created_at timestamptz,
  updated_at timestamptz
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
  select m.id, m.commission_id, m.name, m.description, m.sort_order, m.status,
    m.started_at, m.submitted_at, m.approved_at, m.note, m.created_at, m.updated_at
  from public.commission_milestones m
  where m.commission_id = p_commission_id
  order by m.sort_order asc;
end;
$$;

revoke all on function public.list_commission_milestones(uuid) from public;
grant execute on function public.list_commission_milestones(uuid) to authenticated;
