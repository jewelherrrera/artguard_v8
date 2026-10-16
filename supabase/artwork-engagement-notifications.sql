-- ArtGuard Hub: notify artwork owners about successful Discover engagement.
-- Apply manually after notifications.sql and artwork-engagement.sql, and after
-- the artwork-publication.sql prerequisites have been applied.

alter table public.artwork_likes
  add column if not exists notification_event_id uuid not null default gen_random_uuid();

create unique index if not exists artwork_likes_notification_event_uidx
  on public.artwork_likes(notification_event_id);

alter table public.notifications
  add column if not exists actor_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_name text,
  add column if not exists actor_avatar_data_url text,
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications(dedupe_key)
  where dedupe_key is not null;

drop policy if exists "users can create their own notifications" on public.notifications;
create policy "users can create their own notifications"
on public.notifications for insert
to authenticated
with check (
  recipient_id = auth.uid()
  and notification_type not in ('artwork_like', 'artwork_comment')
  and actor_id is null
  and dedupe_key is null
);

create or replace function public.notify_discover_artwork_engagement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_title text;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_avatar text;
  v_dedupe_key text;
  v_notification_type text;
  v_message text;
begin
  if tg_table_name = 'artwork_likes' then
    v_dedupe_key := 'artwork-like:' || new.notification_event_id::text;
    v_notification_type := 'artwork_like';
    v_actor_id := new.user_id;
  elsif tg_table_name = 'artwork_comments' then
    v_dedupe_key := 'artwork-comment:' || new.id::text;
    v_notification_type := 'artwork_comment';
    v_actor_id := new.author_id;
  else
    raise exception 'Unsupported artwork engagement notification source';
  end if;

  select a.owner_id, a.title
    into v_owner_id, v_title
  from public.artworks a
  join public.profiles owner_profile
    on owner_profile.id = a.owner_id
   and owner_profile.role = 'artist'
  where a.id = new.artwork_id
    and a.status = 'ready'
    and a.protected_storage_path is not null
    and a.visibility = 'discover';

  if not found or v_owner_id = v_actor_id then
    return new;
  end if;

  select p.name, p.avatar_data_url
    into v_actor_name, v_actor_avatar
  from public.profiles p
  where p.id = v_actor_id;

  v_actor_name := coalesce(v_actor_name, 'An ArtGuard user');
  if tg_table_name = 'artwork_likes' then
    v_message := format('%s liked your artwork %s.', v_actor_name, v_title);
  else
    v_message := format('%s commented on your artwork %s.', v_actor_name, v_title);
    if length(btrim(new.body)) > 0 then
      v_message := v_message || ' “' || left(regexp_replace(btrim(new.body), '[[:space:]]+', ' ', 'g'), 120) || '”';
    end if;
  end if;

  insert into public.notifications (
    recipient_id,
    notification_type,
    title,
    message,
    related_id,
    related_route,
    actor_id,
    actor_name,
    actor_avatar_data_url,
    dedupe_key
  )
  values (
    v_owner_id,
    v_notification_type,
    case when tg_table_name = 'artwork_likes' then 'Artwork liked' else 'New artwork comment' end,
    v_message,
    new.artwork_id,
    '/market/artwork/' || new.artwork_id::text,
    v_actor_id,
    v_actor_name,
    v_actor_avatar,
    v_dedupe_key
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.notify_discover_artwork_engagement() from public, anon, authenticated;

drop trigger if exists artwork_likes_notify_owner on public.artwork_likes;
create trigger artwork_likes_notify_owner
after insert on public.artwork_likes
for each row execute function public.notify_discover_artwork_engagement();

drop trigger if exists artwork_comments_notify_owner on public.artwork_comments;
create trigger artwork_comments_notify_owner
after insert on public.artwork_comments
for each row execute function public.notify_discover_artwork_engagement();
