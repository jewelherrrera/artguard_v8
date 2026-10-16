-- Apply once after the existing ArtGuard schema. This migration stores
-- date-of-birth data separately from profiles and does not expose it to clients.
begin;

create table if not exists public.profile_private_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  created_at timestamptz not null default now()
);

alter table public.profile_private_details enable row level security;

revoke all on table public.profile_private_details from public, anon, authenticated;

create or replace function public.store_user_date_of_birth()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_date_of_birth date;
  v_date_text text;
begin
  v_date_text := new.raw_user_meta_data ->> 'date_of_birth';

  if v_date_text is null or v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return new;
  end if;

  begin
    v_date_of_birth := v_date_text::date;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      return new;
  end;

  if to_char(v_date_of_birth, 'YYYY-MM-DD') <> v_date_text then
    return new;
  end if;

  insert into public.profile_private_details (user_id, date_of_birth)
  values (new.id, v_date_of_birth)
  on conflict (user_id) do update
    set date_of_birth = excluded.date_of_birth;

  return new;
end;
$$;

revoke all on function public.store_user_date_of_birth() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_store_private_details on auth.users;
create trigger on_auth_user_created_store_private_details
after insert on auth.users
for each row execute function public.store_user_date_of_birth();

commit;
