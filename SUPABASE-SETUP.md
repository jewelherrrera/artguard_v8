# ArtGuard Hub — Real Backend Setup

The code is ready for real multi-user accounts, profile discovery, chat, read state, reactions, and online/last-seen presence.

## 1. Create the Supabase project

Create a project in Supabase and open its SQL Editor.

Run the entire file:

`supabase/schema.sql`

That creates:

- `profiles`
- `conversations`
- `conversation_participants`
- `messages`
- auth profile trigger
- `get_or_create_conversation(...)`
- Row Level Security policies
- Realtime publication entries

## 2. Repair/enable profile inserts

If `Table Editor → profiles` is empty, run `supabase/profile-repair.sql` once in SQL Editor. This also adds the safe self-insert RLS policy used immediately after signup.

## 3. Add the frontend environment variables

Create:

`artguard/.env.local`

with:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Use the **publishable** key supplied by Supabase. Do not use a service-role/secret key in a browser app.

## 4. Install the new dependency

From `artguard/`:

```bash
npm install
```

The project now includes:

```json
"@supabase/supabase-js": "^2.115.0"
```

## 5. Authentication

For a classroom/demo build, the easiest path is to temporarily disable email confirmation in Supabase Auth so a new signup immediately receives a session.

With email confirmation enabled:

1. Sign up.
2. Confirm the email.
3. Return to ArtGuard Hub and log in.

The auth trigger automatically creates the matching `profiles` row.

### Password strength policy

The application checks new passwords for an 8-character minimum, uppercase and
lowercase letters, a digit, a symbol, and common/repeated/sequential patterns.
The same check runs before either mock or Supabase signup. This is an
application-side check; it does not configure or prove enforcement by Supabase.

To enforce the character rules at the provider, open **Authentication → Sign In
/ Providers → Email → Password security** in the Supabase Dashboard. Set the
minimum password length to **8** and require **lowercase letters, uppercase
letters, digits, and symbols**. Supabase's current password-security
documentation warns that newly strengthened requirements can also reject
existing users' passwords during `signInWithPassword` ([password security
guide](https://supabase.com/docs/guides/auth/password-security)). Because that could
prevent existing users from logging in, do not enable the stronger provider
policy until its impact on existing accounts has been assessed. The dashboard
setting is not visible to this repository, so provider-side enforcement must
be verified in the project itself.

## 6. Testing multi-user chat

Use two separate browser sessions:

- Browser profile / normal Chrome window = Account A
- Incognito window = Account B

Create two accounts, then:

1. Sign in as A.
2. Open **Messages**.
3. Search B by name.
4. Start a conversation.
5. Send a message.
6. Sign in as B in the second session.
7. Open **Messages**.
8. The conversation and message should be present.
9. Send a reply.
10. Return to A — the reply should arrive through Realtime without manually refreshing.

Presence is also Realtime-based. While B is connected, A sees **Active now**. After B disconnects,
the profile falls back to the saved `last_seen_at` heartbeat, such as **Active 2m ago**.

## Important scope note

This implementation stores image/file attachment **metadata** in the database, matching the current UI.
Actual binary uploads to Supabase Storage are not part of this first backend pass. The existing picker
still uses the project's current mock attachment behavior.

## Secure artwork storage (Batch A)

Run `supabase/artworks.sql` once in the Supabase SQL Editor after the base
schema/profile repair scripts. This creates:

- `public.artworks`, with owner-only RLS for artwork metadata.
- A private `artworks` Storage bucket with owner-scoped object policies.
- JPG/PNG and 40MB server-enforced Storage/database constraints.

The Shield upload path stores originals under an authenticated user's folder
and never creates public URLs. The application can request a short-lived
owner-authorized signed URL, but Batch A does not yet process watermarking,
cloaking, tiling, encryption, or protected derivatives.

If the migration has not been run, Shield uploads fail with a setup error; the
app does not fall back to local or public storage.

### Artwork publishing and Discover

To enable persisted artwork publication controls and real protected artwork in
Discover, manually review and run `supabase/artwork-publication.sql` in the
Supabase SQL Editor after `artworks.sql`, `protection.sql`,
`artist-public-portfolio.sql`, `artist-verification-admin-preview.sql`, and
`commission-deliverables-foundation.sql` have been applied. This migration is
not run by the application or build.

The migration preserves previously public portfolio entries by assigning
existing ready artworks with a protected derivative to **Protected Portfolio**.
It then defaults new artwork to **Private**, adds the upload categories
Character, Chibi, Concept Art, Portrait, Fanart, Environment, and Other, and
limits portfolio and Discover queries plus protected-derivative storage access
to eligible visibility. Original files remain private, and the existing
verification and commission-deliverable policies remain separate.

### Persistent Discover likes and comments

After all prerequisites for `supabase/artwork-publication.sql` have been applied,
manually review and run `supabase/artwork-engagement.sql` in the Supabase SQL
Editor. Apply it after `artworks.sql`, `artist-public-portfolio.sql`, and
`artwork-publication.sql`; the publication migration itself requires the
protection, artist-verification preview, and commission-deliverable foundation
migrations described above. Neither migration is run automatically by the app.

The engagement migration adds `artwork_likes` with a unique `(artwork_id,
user_id)` primary key and `artwork_comments` with author/artwork foreign keys,
non-empty/2,000-character checks, and artwork/order indexes. RLS is enabled,
direct table privileges are revoked, and authenticated, narrowly scoped RPCs
provide counts, current-user like state, comments, idempotent like changes, and
comment creation. RPCs require `auth.uid()` and accept only ready artwork with
a protected derivative and `visibility = 'discover'`. There is no edit or
delete-comment UI/API in this phase.

Supabase-backed Discover interactions read and write those persisted records.
Mock mode keeps session-only likes/comments and labels them as demo behavior.
There is no Realtime synchronization; another client sees changes after it
fetches the artwork/engagement again. This repository change has not been
verified against a live development Supabase project, and the migration has not
been run against any database. Verify it on a dedicated development project
before deployment; do not apply it to production without review.

To notify artwork owners about new Discover likes and comments, apply
`supabase/artwork-engagement-notifications.sql` manually after `notifications.sql`
and `artwork-engagement.sql`, with the publication migration prerequisites
above installed first. It extends the existing `notifications` table and uses
database triggers on successful engagement inserts; it does not create a second
notification store or emit notifications for existing likes/comments. Existing
recipient-filtered Realtime delivery is reused. Do not run this migration
against production automatically.

Password reset is wired to Supabase Auth, but the app does not yet include a dedicated reset-password
page route. That is a separate follow-up feature.


## Usernames and public profiles update

Run `supabase/add-usernames.sql` once in the Supabase SQL Editor. It adds a `username` column and
backfills it from the email local-part, so `example@gmail.com` is shown as `@example` in ArtGuard.

After this update, the Messages search looks for either a display name or `@username`. Clicking a
person opens their public profile first, where the user can see the person's name, @username, role,
presence/last-seen status, bio/interests, and a **Message @username** button. Desktop Messages search
uses the same People search as mobile/tablet, so the behavior is consistent on wide web screens too.


### Important for the existing project

Because your existing `profiles` table was already created before usernames were added, run
`supabase/add-usernames.sql` once. You do not need to rerun the full `schema.sql`.

## Role-symmetric public commission posts

To enable Client- and Artist-owned public commission posts, run these forward-only SQL files
in the Supabase SQL Editor after the existing public commission-post migrations have been
applied:

1. `supabase/commission-post-role-symmetry.sql`
2. `supabase/commission-post-symmetric-selection.sql`
3. `supabase/commission-start-symmetric-public-post-payment-guard.sql`

The first migration backfills existing posts as Client-owned and existing applications as
Artist-submitted while retaining the legacy `client_id` and `artist_id` columns. It does not
delete or recreate existing post/application rows. The second adds transactional selection
for either owner role. The third preserves public-post provenance and the paid-before-start
requirement for both commission participant mappings. Do not run these migrations before
their existing commission-post, comments, notifications, commissions, and payment
dependencies are installed.
