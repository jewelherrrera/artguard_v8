-- ArtGuard Hub: Commission Milestone Batch C - client approval
-- Run after commission-milestones-foundation.sql, notifications.sql, and
-- commission-milestones-workflow.sql. Preserves existing milestone data.

create or replace function public.approve_commission_milestone(p_milestone_id uuid)
returns public.commission_milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_milestone public.commission_milestones;
  v_commission public.commissions;
  v_client_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, name into v_role, v_client_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Client profile not found'; end if;
  if v_role <> 'client' then raise exception 'Only clients can approve milestones'; end if;

  select m.* into v_milestone
  from public.commission_milestones m
  where m.id = p_milestone_id;
  if v_milestone.id is null then raise exception 'Milestone not found'; end if;

  select c.* into v_commission
  from public.commissions c
  where c.id = v_milestone.commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.client_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status not in ('IN_PROGRESS', 'REVISION_REQUESTED') then
    raise exception 'Commission is not accepting milestone approval';
  end if;
  if v_milestone.status <> 'SUBMITTED' then raise exception 'Only submitted milestones can be approved'; end if;

  update public.commission_milestones
  set status = 'APPROVED', approved_at = now()
  where id = v_milestone.id
  returning * into v_milestone;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.artist_id,
    'commission',
    'Milestone Approved',
    coalesce(v_client_name, 'The client') || ' approved the ' || v_milestone.name || ' milestone.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_milestone;
end;
$$;

revoke all on function public.approve_commission_milestone(uuid) from public;
grant execute on function public.approve_commission_milestone(uuid) to authenticated;