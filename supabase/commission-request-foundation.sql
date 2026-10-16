-- ArtGuard Hub: Commission Batch 1 - real request foundation
-- Run after revision-requests.sql / real-commissions.sql.
-- Preserves existing commission and revision data.

alter table public.commissions
  add column if not exists description text,
  add column if not exists status text,
  add column if not exists requested_at timestamptz;

-- Existing rows were already-established commission links, not pending requests.
-- Preserve them as accepted relationships and retain their original creation time.
update public.commissions
set status = 'ACCEPTED'
where status is null;

update public.commissions
set requested_at = created_at
where requested_at is null;

alter table public.commissions
  alter column status set default 'ACCEPTED',
  alter column status set not null,
  alter column requested_at set default now(),
  alter column requested_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commissions'::regclass
      and conname = 'commissions_status_check'
  ) then
    alter table public.commissions
      add constraint commissions_status_check
      check (status in (
        'REQUESTED',
        'ACCEPTED',
        'REJECTED',
        'IN_PROGRESS',
        'REVISION_REQUESTED',
        'COMPLETED',
        'CANCELLED'
      ));
  end if;
end;
$$;

create index if not exists commissions_pair_status_idx
  on public.commissions(client_id, artist_id, status);

-- New client requests are created only through this RPC. An existing requested
-- or accepted pair is returned instead of creating a duplicate active request.
create or replace function public.create_commission_request(
  p_artist_id uuid,
  p_title text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := auth.uid();
  v_client_role text;
  v_artist_role text;
  v_existing public.commissions;
  v_created public.commissions;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_order_ref text := 'CM-' || gen_random_uuid()::text;
begin
  if v_client_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_artist_id is null or p_artist_id = v_client_id then
    raise exception 'Invalid artist';
  end if;
  if v_title is null then
    raise exception 'Commission title is required';
  end if;
  if v_description is null then
    raise exception 'Commission description is required';
  end if;

  select role into v_client_role
  from public.profiles
  where id = v_client_id;

  select role into v_artist_role
  from public.profiles
  where id = p_artist_id;

  if v_client_role is null then
    raise exception 'Client profile not found';
  end if;
  if v_client_role <> 'client' then
    raise exception 'Only client accounts can create commission requests';
  end if;
  if v_artist_role is null then
    raise exception 'Artist profile not found';
  end if;
  if v_artist_role <> 'artist' then
    raise exception 'The selected account is not an artist';
  end if;

  select * into v_existing
  from public.commissions
  where client_id = v_client_id
    and artist_id = p_artist_id
    and status in ('REQUESTED', 'ACCEPTED')
  order by requested_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object('commission_id', v_existing.id, 'created', false);
  end if;

  insert into public.commissions (
    order_ref,
    client_id,
    artist_id,
    title,
    description,
    status,
    requested_at
  )
  values (
    v_order_ref,
    v_client_id,
    p_artist_id,
    v_title,
    v_description,
    'REQUESTED',
    now()
  )
  returning * into v_created;

  return jsonb_build_object('commission_id', v_created.id, 'created', true);
end;
$$;

revoke all on function public.create_commission_request(uuid, text, text) from public;
grant execute on function public.create_commission_request(uuid, text, text) to authenticated;

-- Commission creation is controlled by the request RPC. Existing reads remain
-- party-scoped; lifecycle updates remain unavailable to authenticated clients.
revoke insert on public.commissions from authenticated;
drop policy if exists "either party can create a commission link" on public.commissions;
