-- ArtGuard Hub: real commission final completion workflow
-- Run after the existing commission, notification, deliverable, revision,
-- progress, milestone, and cancellation migrations.

alter table public.commissions
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id);

create or replace function public.complete_commission(p_commission_id uuid)
returns table (commission_id uuid, status text, completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_client_name text;
  v_commission public.commissions;
  v_completed_at timestamptz;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, name into v_role, v_client_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Client profile not found'; end if;
  if v_role <> 'client' then raise exception 'Only clients can complete commissions'; end if;

  select * into v_commission
  from public.commissions
  where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.client_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status not in ('IN_PROGRESS', 'REVISION_REQUESTED') then
    raise exception 'Commission cannot be completed in its current state';
  end if;

  if not exists (
    select 1 from public.commission_milestones m
    where m.commission_id = v_commission.id
  ) then
    raise exception 'Commission must have milestones before completion';
  end if;
  if exists (
    select 1 from public.commission_milestones m
    where m.commission_id = v_commission.id
      and m.status <> 'APPROVED'
  ) then
    raise exception 'All milestones must be approved before completion';
  end if;

  if exists (
    select 1 from public.commission_deliverables d
    where d.commission_id = v_commission.id
      and d.status <> 'APPROVED'
  ) then
    raise exception 'All deliverables must be approved before completion';
  end if;

  if exists (
    select 1 from public.revision_requests r
    where r.commission_id = v_commission.id
      and r.status in ('OPEN', 'IN_PROGRESS', 'SUBMITTED')
  ) then
    raise exception 'Resolve all revision requests before completion';
  end if;

  v_completed_at := now();
  update public.commissions as c
  set status = 'COMPLETED', completed_at = v_completed_at, completed_by = v_user
  where c.id = v_commission.id
    and c.status in ('IN_PROGRESS', 'REVISION_REQUESTED');

  if not found then raise exception 'Commission was already completed or is no longer active'; end if;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.artist_id,
    'commission',
    'Commission Completed',
    coalesce(v_client_name, 'The client') || ' completed the commission "' || v_commission.title || '".',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return query select v_commission.id, 'COMPLETED'::text, v_completed_at;
end;
$$;

revoke all on function public.complete_commission(uuid) from public;
grant execute on function public.complete_commission(uuid) to authenticated;

-- Preserve the cancellation guard and extend it to completed commissions.
create or replace function public.reject_cancelled_commission_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.commissions c
    where c.id = new.commission_id
      and c.status in ('CANCELLED', 'COMPLETED')
  ) then
    raise exception 'Closed commissions do not accept new workflow actions';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_cancelled_commission_mutation() from public;