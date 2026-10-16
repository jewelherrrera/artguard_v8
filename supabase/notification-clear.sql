-- ArtGuard Hub: secure current-user notification clearing

create or replace function public.clear_my_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  delete from public.notifications
  where recipient_id = auth.uid();
end;
$$;

revoke all on function public.clear_my_notifications() from public;
grant execute on function public.clear_my_notifications() to authenticated;
