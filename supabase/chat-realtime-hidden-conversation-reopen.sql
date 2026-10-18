-- Ensure the recipient can receive realtime participant-row updates after a
-- hidden conversation is reopened by the message-insert trigger.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_participants'
  ) then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end;
$$;

drop policy if exists "users can read own conversation participant rows"
  on public.conversation_participants;
create policy "users can read own conversation participant rows"
on public.conversation_participants for select
to authenticated
using (user_id = auth.uid());
