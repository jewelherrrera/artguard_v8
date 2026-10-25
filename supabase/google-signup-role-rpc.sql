-- Persist the selected role for an incomplete Google signup without granting
-- authenticated clients permission to update the protected profiles.role column.
create or replace function public.set_my_signup_role(p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_role is null or p_role not in ('artist', 'client') then
    raise exception 'Invalid profile role'
      using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role
  where id = v_user_id
    and onboarded = false
    and coalesce(cardinality(interests), 0) = 0;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.set_my_signup_role(text) from public, anon, authenticated;
grant execute on function public.set_my_signup_role(text) to authenticated;
