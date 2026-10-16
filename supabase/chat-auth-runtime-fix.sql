-- ArtGuard Hub: chat participant RLS recursion fix
-- Run once on projects with the original conversation_participants policies.

create or replace function public.is_current_user_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = p_conversation_id
        and cp.user_id = auth.uid()
    );
$$;

revoke all on function public.is_current_user_conversation_participant(uuid) from public, anon;
grant execute on function public.is_current_user_conversation_participant(uuid) to authenticated;

drop policy if exists "participants can read participant rows" on public.conversation_participants;
create policy "participants can read participant rows"
on public.conversation_participants for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_conversation_participant(conversation_id)
);

-- Conversation creation is performed by get_or_create_conversation(), which
-- runs as SECURITY DEFINER. Clients must not self-join arbitrary conversations.
drop policy if exists "users can add themselves to conversations" on public.conversation_participants;
revoke insert on public.conversation_participants from authenticated;