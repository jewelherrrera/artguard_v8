-- ArtGuard Hub — Batch 1: Real Revision Request System
-- Run this ONCE in the Supabase SQL Editor, after schema.sql / fix-direct-chat.sql.
-- Safe to re-run (idempotent): tables/policies/functions all use if-not-exists /
-- create-or-replace / drop-then-create patterns, matching the rest of this project.
--
-- Does NOT touch profiles, conversations, conversation_participants, or messages —
-- the direct-chat system is untouched by this file.

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) Commissions — the minimum real link between one client and
--    one artist that a revision request can be checked against.
--
--    The existing commission-workspace UI only knows about a
--    hardcoded demo "order" (id, title, milestones, escrow) with no
--    real second account attached to it — every signed-in user sees
--    the same mock orders today. A revision request needs a REAL
--    client_id/artist_id pair to enforce permissions against, so
--    this table exists purely to hold that pairing.
--
--    This is intentionally minimal — no milestones, no escrow, no
--    pricing. Those stay out of scope for this batch. A later batch
--    can ALTER this table (or add related tables that reference it)
--    instead of creating a second, competing "commissions" table.
-- ------------------------------------------------------------
create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  -- Stable key tying this row back to the demo Order shown in the UI
  -- (mockData.ts Order.id, e.g. "AG-2291"). One real commission link
  -- per demo order.
  order_ref text not null unique,
  client_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commissions_distinct_parties check (client_id <> artist_id)
);

create index if not exists commissions_client_idx on public.commissions(client_id);
create index if not exists commissions_artist_idx on public.commissions(artist_id);

-- Reuses the set_updated_at() trigger function already defined in schema.sql.
drop trigger if exists commissions_set_updated_at on public.commissions;
create trigger commissions_set_updated_at
before update on public.commissions
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2) Revision requests
--
--    One row per revision request, for the life of that request.
--    Status moves forward in place (OPEN -> IN_PROGRESS -> SUBMITTED
--    -> RESOLVED) on the SAME row; a new revision request (e.g. a
--    second round after RESOLVED) always inserts a NEW row, so
--    nothing is ever overwritten and full history stays queryable.
-- ------------------------------------------------------------
create table if not exists public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions(id) on delete cascade,
  -- Reserved for when a real milestones table exists. No milestone
  -- system exists in the database yet (only display strings in the
  -- mock Order data), so this stays null/unused for now. Typed as
  -- uuid (no FK yet) so a `references public.milestones(id)`
  -- constraint can be added later without a column type change.
  milestone_id uuid,
  client_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'RESOLVED')),
  -- The artist's written response when submitting revised work. No
  -- file uploads in this batch, so this is the "revised work" payload.
  response_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint revision_requests_description_not_blank check (length(btrim(description)) > 0),
  constraint revision_requests_distinct_parties check (client_id <> artist_id)
);

create index if not exists revision_requests_commission_idx
  on public.revision_requests(commission_id, created_at desc);
create index if not exists revision_requests_client_idx on public.revision_requests(client_id);
create index if not exists revision_requests_artist_idx on public.revision_requests(artist_id);

drop trigger if exists revision_requests_set_updated_at on public.revision_requests;
create trigger revision_requests_set_updated_at
before update on public.revision_requests
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3) get_or_create_commission — one-time real-account link for a
--    demo order. Mirrors the existing get_or_create_conversation
--    pattern (schema.sql / fix-direct-chat.sql): idempotent,
--    security definer, resolves to the same row on every call for
--    the same order_ref.
-- ------------------------------------------------------------
create or replace function public.get_or_create_commission(
  p_order_ref text,
  p_counterparty_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_user uuid := auth.uid();
  v_current_role text;
  v_other_role text;
  v_commission_id uuid;
  v_client_id uuid;
  v_artist_id uuid;
begin
  if v_current_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_order_ref is null or btrim(p_order_ref) = '' then
    raise exception 'Missing order reference';
  end if;
  if p_counterparty_id is null or p_counterparty_id = v_current_user then
    raise exception 'Invalid counterparty';
  end if;

  select role into v_current_role from public.profiles where id = v_current_user;
  select role into v_other_role from public.profiles where id = p_counterparty_id;

  if v_current_role is null or v_other_role is null then
    raise exception 'Both accounts must have a profile';
  end if;
  if v_current_role = v_other_role then
    raise exception 'A commission needs one client and one artist';
  end if;

  if v_current_role = 'client' then
    v_client_id := v_current_user;
    v_artist_id := p_counterparty_id;
  else
    v_client_id := p_counterparty_id;
    v_artist_id := v_current_user;
  end if;

  select id into v_commission_id from public.commissions where order_ref = p_order_ref;

  if v_commission_id is null then
    insert into public.commissions (order_ref, client_id, artist_id, title)
    values (p_order_ref, v_client_id, v_artist_id, coalesce(p_title, p_order_ref))
    on conflict (order_ref) do nothing
    returning id into v_commission_id;

    if v_commission_id is null then
      -- Lost a race with another insert for the same order_ref — read it back.
      select id into v_commission_id from public.commissions where order_ref = p_order_ref;
    end if;
  end if;

  -- Guard against re-linking an order that's already tied to a different pair.
  if not exists (
    select 1 from public.commissions c
    where c.id = v_commission_id
      and v_current_user in (c.client_id, c.artist_id)
  ) then
    raise exception 'This order is already linked to a different pair of accounts';
  end if;

  return v_commission_id;
end;
$$;

grant execute on function public.get_or_create_commission(text, uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4) create_revision_request — client-only. Validates the caller is
--    actually the commission's client and the description isn't
--    blank (defense in depth alongside the table check constraint
--    and the RLS insert policy below).
-- ------------------------------------------------------------
create or replace function public.create_revision_request(
  p_commission_id uuid,
  p_description text
)
returns public.revision_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_commission public.commissions;
  v_row public.revision_requests;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Description cannot be empty';
  end if;

  select * into v_commission from public.commissions where id = p_commission_id;
  if v_commission.id is null then
    raise exception 'Commission not found';
  end if;
  if v_commission.client_id <> v_user then
    raise exception 'Only the client on this commission can create a revision request';
  end if;

  insert into public.revision_requests (commission_id, client_id, artist_id, description, status)
  values (p_commission_id, v_commission.client_id, v_commission.artist_id, btrim(p_description), 'OPEN')
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_revision_request(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5) set_revision_status — the only way a revision request's status
--    changes. Enforces both WHO can make a transition and WHICH
--    transitions are legal, since a plain RLS UPDATE policy can't
--    compare the row's old status to its new status the way this
--    function can.
--
--    OPEN        -> IN_PROGRESS  (artist only)
--    IN_PROGRESS -> SUBMITTED    (artist only, requires response_text)
--    SUBMITTED   -> RESOLVED     (client only)
--    anything else is rejected.
-- ------------------------------------------------------------
create or replace function public.set_revision_status(
  p_revision_id uuid,
  p_status text,
  p_response_text text default null
)
returns public.revision_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.revision_requests;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_status not in ('IN_PROGRESS', 'SUBMITTED', 'RESOLVED') then
    raise exception 'Invalid status';
  end if;

  select * into v_row from public.revision_requests where id = p_revision_id;
  if v_row.id is null then
    raise exception 'Revision request not found';
  end if;
  if v_user not in (v_row.client_id, v_row.artist_id) then
    raise exception 'Not authorized for this revision request';
  end if;

  if p_status = 'IN_PROGRESS' then
    if v_user <> v_row.artist_id or v_row.status <> 'OPEN' then
      raise exception 'Invalid status transition';
    end if;
    update public.revision_requests set status = 'IN_PROGRESS'
      where id = p_revision_id returning * into v_row;

  elsif p_status = 'SUBMITTED' then
    if v_user <> v_row.artist_id or v_row.status <> 'IN_PROGRESS' then
      raise exception 'Invalid status transition';
    end if;
    if length(btrim(coalesce(p_response_text, ''))) = 0 then
      raise exception 'A response is required to submit this revision';
    end if;
    update public.revision_requests set status = 'SUBMITTED', response_text = btrim(p_response_text)
      where id = p_revision_id returning * into v_row;

  elsif p_status = 'RESOLVED' then
    if v_user <> v_row.client_id or v_row.status <> 'SUBMITTED' then
      raise exception 'Invalid status transition';
    end if;
    update public.revision_requests set status = 'RESOLVED'
      where id = p_revision_id returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.set_revision_status(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 6) Row Level Security
-- ------------------------------------------------------------
alter table public.commissions enable row level security;
alter table public.revision_requests enable row level security;

drop policy if exists "commission parties can read" on public.commissions;
create policy "commission parties can read"
on public.commissions for select
to authenticated
using (auth.uid() = client_id or auth.uid() = artist_id);

drop policy if exists "either party can create a commission link" on public.commissions;
create policy "either party can create a commission link"
on public.commissions for insert
to authenticated
with check (
  (auth.uid() = client_id or auth.uid() = artist_id)
  and client_id <> artist_id
);

drop policy if exists "revision parties can read" on public.revision_requests;
create policy "revision parties can read"
on public.revision_requests for select
to authenticated
using (auth.uid() = client_id or auth.uid() = artist_id);

drop policy if exists "client can create their own revision request" on public.revision_requests;
create policy "client can create their own revision request"
on public.revision_requests for insert
to authenticated
with check (
  client_id = auth.uid()
  and length(btrim(description)) > 0
  and exists (
    select 1 from public.commissions c
    where c.id = commission_id
      and c.client_id = auth.uid()
      and c.artist_id = revision_requests.artist_id
  )
);

-- Row-level ownership guard for UPDATE. No UPDATE privilege is
-- granted to `authenticated` below on purpose — every real status
-- change goes through set_revision_status(), which is the only
-- place old-status -> new-status transitions and per-role rules are
-- actually enforced. This policy exists so that if UPDATE is ever
-- granted directly in the future, a caller still can't touch a row
-- that isn't theirs.
drop policy if exists "revision parties can update their own revision request" on public.revision_requests;
create policy "revision parties can update their own revision request"
on public.revision_requests for update
to authenticated
using (auth.uid() = client_id or auth.uid() = artist_id)
with check (auth.uid() = client_id or auth.uid() = artist_id);

grant select, insert on public.commissions to authenticated;
grant select, insert on public.revision_requests to authenticated;
