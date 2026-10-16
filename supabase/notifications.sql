-- ArtGuard Hub: global notifications foundation
-- Safe to run in an existing Supabase project.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  related_id uuid,
  related_route text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_recipient_read_idx
  on public.notifications(recipient_id, is_read);

alter table public.notifications enable row level security;

drop policy if exists "users can read their own notifications" on public.notifications;
create policy "users can read their own notifications"
on public.notifications for select
to authenticated
using (recipient_id = auth.uid());

drop policy if exists "users can mark their own notifications read" on public.notifications;
create policy "users can mark their own notifications read"
on public.notifications for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- Client-side creation is limited to the caller's own row. Future features that
-- notify another user should create rows in a trusted server-side function or
-- Edge Function, rather than accepting arbitrary recipient IDs from a browser.
drop policy if exists "users can create their own notifications" on public.notifications;
create policy "users can create their own notifications"
on public.notifications for insert
to authenticated
with check (recipient_id = auth.uid());

revoke update on table public.notifications from authenticated;
grant select, insert on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
