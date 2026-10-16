-- ArtGuard Hub — Batch 1A: real commission creation
-- Run this ONCE in the Supabase SQL Editor, AFTER revision-requests.sql.
-- Safe to re-run (idempotent). Does not touch profiles, conversations,
-- conversation_participants, messages, revision_requests, or any RLS
-- policy — only upgrades one existing function.
--
-- This does NOT create a new commissions/revision table — public.commissions
-- and public.revision_requests (from revision-requests.sql) are reused as-is.

-- ------------------------------------------------------------
-- get_or_create_commission — same function, same name, same core
-- security logic (auth check, role validation, self-link prevention,
-- ownership re-check) as revision-requests.sql. The only change:
-- p_order_ref is now optional.
--
--   - Called WITH an order_ref (unchanged path — e.g. linking a demo
--     Order like "AG-2291" to two real accounts): behaves exactly as
--     before.
--   - Called WITHOUT an order_ref (new path — starting a brand new
--     real commission that has no demo order behind it): the
--     function generates the reference itself from a
--     database-generated random value (the same gen_random_uuid()
--     primitive already used for every primary key in this schema),
--     so uniqueness is guaranteed by Postgres, not invented by the
--     frontend.
-- ------------------------------------------------------------
create or replace function public.get_or_create_commission(
  p_order_ref text default null,
  p_counterparty_id uuid default null,
  p_title text default null
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
  v_ref text;
begin
  if v_current_user is null then
    raise exception 'Not authenticated';
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

  v_ref := nullif(btrim(coalesce(p_order_ref, '')), '');

  if v_ref is not null then
    -- Explicit reference supplied — unchanged behavior: look up or
    -- create the commission for that reference.
    select id into v_commission_id from public.commissions where order_ref = v_ref;

    if v_commission_id is null then
      insert into public.commissions (order_ref, client_id, artist_id, title)
      values (v_ref, v_client_id, v_artist_id, coalesce(p_title, v_ref))
      on conflict (order_ref) do nothing
      returning id into v_commission_id;

      if v_commission_id is null then
        select id into v_commission_id from public.commissions where order_ref = v_ref;
      end if;
    end if;
  else
    -- No reference supplied: this is a brand-new real commission with
    -- no demo order behind it. Always insert a new row — there is
    -- nothing to look up yet — with a reference the database itself
    -- generated.
    v_ref := 'CM-' || upper(substr(gen_random_uuid()::text, 1, 8));

    insert into public.commissions (order_ref, client_id, artist_id, title)
    values (v_ref, v_client_id, v_artist_id, coalesce(p_title, 'Commission'))
    returning id into v_commission_id;
  end if;

  -- Guard against re-linking a reference that's already tied to a
  -- different pair of accounts (unchanged from revision-requests.sql).
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
