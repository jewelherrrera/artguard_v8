-- ArtGuard Hub: Commission Milestone Batch B - artist workflow
-- Run after commission-milestones-foundation.sql and notifications.sql.
-- Keeps milestone writes RPC-only and preserves existing milestone data.

create or replace function public.start_commission_milestone(p_milestone_id uuid)
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
  v_artist_name text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, name into v_role, v_artist_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can start milestones'; end if;

  select m.* into v_milestone
  from public.commission_milestones m
  where m.id = p_milestone_id;
  if v_milestone.id is null then raise exception 'Milestone not found'; end if;

  select c.* into v_commission
  from public.commissions c
  where c.id = v_milestone.commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'IN_PROGRESS' then raise exception 'Commission must be in progress'; end if;
  if v_milestone.status <> 'PENDING' then raise exception 'Only pending milestones can be started'; end if;
  if exists (
    select 1
    from public.commission_milestones previous
    where previous.commission_id = v_milestone.commission_id
      and previous.sort_order < v_milestone.sort_order
      and previous.status not in ('SUBMITTED', 'APPROVED')
  ) then
    raise exception 'Complete the previous milestone before starting this one';
  end if;

  update public.commission_milestones
  set status = 'IN_PROGRESS', started_at = now()
  where id = v_milestone.id
  returning * into v_milestone;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.client_id,
    'commission',
    'Milestone Started',
    coalesce(v_artist_name, 'Your artist') || ' started the ' || v_milestone.name || ' milestone.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_milestone;
end;
$$;

revoke all on function public.start_commission_milestone(uuid) from public;
grant execute on function public.start_commission_milestone(uuid) to authenticated;

create or replace function public.submit_commission_milestone(
  p_milestone_id uuid,
  p_note text
)
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
  v_artist_name text;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, name into v_role, v_artist_name
  from public.profiles
  where id = v_user;
  if v_role is null then raise exception 'Artist profile not found'; end if;
  if v_role <> 'artist' then raise exception 'Only artists can submit milestones'; end if;

  select m.* into v_milestone
  from public.commission_milestones m
  where m.id = p_milestone_id;
  if v_milestone.id is null then raise exception 'Milestone not found'; end if;

  select c.* into v_commission
  from public.commissions c
  where c.id = v_milestone.commission_id;
  if v_commission.id is null then raise exception 'Commission not found'; end if;
  if v_commission.artist_id <> v_user then raise exception 'Not authorized for this commission'; end if;
  if v_commission.status <> 'IN_PROGRESS' then raise exception 'Commission must be in progress'; end if;
  if v_milestone.status <> 'IN_PROGRESS' then raise exception 'Only in-progress milestones can be submitted'; end if;

  update public.commission_milestones
  set status = 'SUBMITTED', submitted_at = now(), note = v_note
  where id = v_milestone.id
  returning * into v_milestone;

  insert into public.notifications (
    recipient_id, notification_type, title, message, related_id, related_route
  )
  values (
    v_commission.client_id,
    'commission',
    'Milestone Submitted',
    coalesce(v_artist_name, 'Your artist') || ' submitted the ' || v_milestone.name || ' milestone for review.',
    v_commission.id,
    '/home/workspace/' || v_commission.id::text
  );

  return v_milestone;
end;
$$;

revoke all on function public.submit_commission_milestone(uuid, text) from public;
grant execute on function public.submit_commission_milestone(uuid, text) to authenticated;