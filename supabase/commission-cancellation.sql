-- ArtGuard Hub: Commission cancellation workflow
-- Run after the existing commission, notification, progress, deliverable,
-- revision, and milestone migrations. Preserves all existing records.

alter table public.commissions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text;

create or replace function public.cancel_commission(
  p_commission_id uuid,
  p_reason text
)
returns public.commissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_commission public.commissions;
  v_reason text := nullif(btrim(p_reason), '');
  v_actor_name text;
  v_recipient uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_reason is null then raise exception 'Cancellation reason is required'; end if;

  select role, name into v_role, v_actor_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Profile not found'; end if;

  select * into v_commission
  from public.commissions
  where id = p_commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;

  if v_user = v_commission.client_id then
    if v_role <> 'client' then raise exception 'Caller role does not match the commission client'; end if;
    if v_commission.status not in ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED') then
      raise exception 'Commission cannot be cancelled in its current state';
    end if;
    v_recipient := v_commission.artist_id;
  elsif v_user = v_commission.artist_id then
    if v_role <> 'artist' then raise exception 'Caller role does not match the commission artist'; end if;
    if v_commission.status not in ('ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED') then
      raise exception 'Commission cannot be cancelled in its current state';
    end if;
    v_recipient := v_commission.client_id;
  else
    raise exception 'Not authorized for this commission';
  end if;

  update public.commissions
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = v_user,
      cancellation_reason = v_reason
  where id = v_commission.id
    and status <> 'CANCELLED'
  returning * into v_commission;

  if v_commission.id is null then raise exception 'Commission was already cancelled'; end if;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_recipient,
    'commission',
    'Commission Cancelled',
    coalesce(v_actor_name, case when v_role = 'client' then 'The client' else 'The artist' end)
      || ' cancelled the commission "' || v_commission.title || '".',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_commission;
end;
$$;

revoke all on function public.cancel_commission(uuid, text) from public;
grant execute on function public.cancel_commission(uuid, text) to authenticated;

-- Preserve the existing RPC-only commission write model.
revoke update on public.commissions from authenticated;

-- Keep historical child records readable, but block all new or changed
-- workflow records once their commission is cancelled.
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
      and c.status = 'CANCELLED'
  ) then
    raise exception 'Cancelled commissions do not accept new workflow actions';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_cancelled_commission_mutation() from public;

drop trigger if exists reject_cancelled_progress_mutation on public.commission_progress_updates;
create trigger reject_cancelled_progress_mutation
before insert or update on public.commission_progress_updates
for each row execute function public.reject_cancelled_commission_mutation();

drop trigger if exists reject_cancelled_deliverable_mutation on public.commission_deliverables;
create trigger reject_cancelled_deliverable_mutation
before insert or update on public.commission_deliverables
for each row execute function public.reject_cancelled_commission_mutation();

drop trigger if exists reject_cancelled_revision_mutation on public.revision_requests;
create trigger reject_cancelled_revision_mutation
before insert or update on public.revision_requests
for each row execute function public.reject_cancelled_commission_mutation();

drop trigger if exists reject_cancelled_milestone_mutation on public.commission_milestones;
create trigger reject_cancelled_milestone_mutation
before insert or update on public.commission_milestones
for each row execute function public.reject_cancelled_commission_mutation();