-- Reopen a recipient's inbox entry when a new message arrives.
-- The recipient's reset_at boundary is intentionally preserved so messages
-- from before they hid the conversation remain hidden.

create or replace function public.unhide_chat_recipient_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
  set hidden_at = null
  where conversation_id = new.conversation_id
    and user_id <> new.sender_id
    and hidden_at is not null;

  return new;
end;
$$;

revoke all on function public.unhide_chat_recipient_after_message() from public, anon, authenticated;

drop trigger if exists messages_unhide_recipient_after_insert on public.messages;
create trigger messages_unhide_recipient_after_insert
after insert on public.messages
for each row
execute function public.unhide_chat_recipient_after_message();
