# ArtGuard Hub — Mobile App

A cross-platform Ionic React + TypeScript app for ArtGuard Hub, built from the
high-fidelity `artguard-hub-ui-mockups.html` case study. All 10 screens from
the mockup are implemented with real navigation, working forms, light/dark
theming, with a mock fallback and an optional Supabase backend — running on Web, Android, and (once you have a
Mac + Xcode) iOS from one codebase.

The visual system (colors, gradients, typography, spacing, cards, buttons,
icons) is ported 1:1 from the mockup's `:root` tokens and component classes.
See **"What changed vs. the mockup"** at the bottom for the handful of
necessary, intentional adaptations.

## Stack

- **Ionic React 9** + **Ionic React Router 9** (React Router 6)
- **React 19** + **TypeScript**
- **Vite** for dev/build
- **Capacitor 7** for the native Android/iOS shells

## The 10 screens

| # | Mockup screen | Route(s) | File |
|---|---|---|---|
| 1 | Splash | `/splash` | `pages/SplashPage.tsx` |
| 2 | Login / Sign Up | `/login`, `/signup`, `/forgot-password` | `pages/LoginPage.tsx`, `SignUpPage.tsx`, `ForgotPasswordPage.tsx` |
| 3 | Home Dashboard | `/home` | `pages/HomeDashboardPage.tsx` |
| 4 | Commission Marketplace | `/market` | `pages/MarketplacePage.tsx` |
| 5 | Artist Profile | `/profile` (self) · `/market/artist/:artistId` (public) | `pages/ArtistProfilePage.tsx` |
| 6 | Commission Workspace | `/home/workspace/:orderId` | `pages/CommissionWorkspacePage.tsx` |
| 7 | Artwork Protection | `/shield` | `pages/ProtectionPage.tsx` |
| 8 | In-App Chat | `/chat` | `pages/ChatPage.tsx` |
| 9 | Analytics Dashboard | `/home/analytics` | `pages/AnalyticsPage.tsx` |
| 10 | Premium Subscription | `/profile/premium` | `pages/PremiumPage.tsx` |
| — | Settings *(new, not in mockup)* | `/profile/settings` | `pages/SettingsPage.tsx` |

## Navigation map

- Splash → Login (auto-advances, tap to skip)
- Login ↔ Sign Up, Login → Forgot Password → back to Login
- Login success → Home Dashboard directly
- Sign Up success → onboarding (name → interests) → Home Dashboard
- Bottom nav (Home, Market, Shield, Chat, Profile) — real navigation, visible
  on Home/Market/Shield/Profile; Chat and Artist-Profile-detail replace it
  with a composer / sticky "Book Commission" bar respectively, matching the
  mockup screens exactly (see adaptations below)
- Home → tap a commission card → Commission Workspace; tap the revenue card
  → Analytics; the Shield teaser card → Protection
- Marketplace → tap an artist → Artist Profile (public, with Book Commission)
- Profile tab → Artist Profile (self) if role is artist, Client Profile if
  role is client (see "Role-based profile" above) → dots menu → Settings on
  both; "Edit Profile" → Edit Profile screen on both
- Artist self-profile → "Upgrade to Pro" banner → Premium
- Commission Workspace → chat icon → Chat
- Settings → back → Profile; Sign Out → Login

## The 10 screens

| # | Mockup screen | Route(s) | File |
|---|---|---|---|
| 1 | Splash | `/splash` | `pages/SplashPage.tsx` |
| 2 | Login / Sign Up | `/login`, `/signup`, `/forgot-password` | `pages/LoginPage.tsx`, `SignUpPage.tsx`, `ForgotPasswordPage.tsx` |
| 3 | Home Dashboard | `/home` | `pages/HomeDashboardPage.tsx` |
| 4 | Commission Marketplace | `/market` | `pages/MarketplacePage.tsx` |
| 5 | Artist Profile | `/profile` (self, artist role) · `/market/artist/:artistId` (public) | `pages/ArtistProfilePage.tsx`, `ProfilePage.tsx` |
| 6 | Commission Workspace | `/home/workspace/:orderId` | `pages/CommissionWorkspacePage.tsx` |
| 7 | Artwork Protection | `/shield` | `pages/ProtectionPage.tsx` |
| 8 | In-App Chat | `/chat` | `pages/ChatPage.tsx` |
| 9 | Analytics Dashboard | `/home/analytics` | `pages/AnalyticsPage.tsx` |
| 10 | Premium Subscription | `/profile/premium` | `pages/PremiumPage.tsx` |
| — | Settings *(new, not in mockup)* | `/profile/settings` | `pages/SettingsPage.tsx` |
| — | Client self-profile *(new — see Role-based profile below)* | `/profile` (self, client role) | `pages/ClientProfilePage.tsx` |
| — | Edit Profile *(new)* | `/profile/edit` | `pages/EditProfilePage.tsx` |
| — | Post-sign-up onboarding *(new)* | `/onboarding/name`, `/onboarding/interests` | `pages/OnboardingNamePage.tsx`, `OnboardingInterestsPage.tsx` |

## Currency

All prices display in Philippine Peso (₱) — e.g. `₱2,480.50`, `₱12/mo`. Only
the currency symbol changed; every underlying numeric value in
`src/data/mockData.ts` is untouched.

## Post-sign-up onboarding

Sign Up no longer lands directly on the Dashboard. On success it now goes:

```
Sign Up → "What should we call you?" → "What are you interested in?" → Home Dashboard
```

- **Name step** (`/onboarding/name`): a real editable text input, pre-filled
  with the name entered at sign-up, saved via `updateProfile()` on Continue.
- **Interests step** (`/onboarding/interests`): multi-select chips (Chibi,
  Digital Art, Traditional Art, Anime, Character Design, Concept Art,
  Illustration, Portraits) with a clear selected state (filled gold chip +
  checkmark). "Continue" and "Skip for now" both save whatever is selected
  (including none) and mark the account `onboarded: true`.
- Logging in with an existing account skips onboarding entirely and goes
  straight to the Dashboard, as before.

## Role-based profile

The Profile tab (`/profile`) now renders a different self-profile depending
on the signed-in account's role (chosen at Sign Up):

- **Artist** → `ArtistProfilePage` in "self" mode: portfolio/showcase layout
  — profile picture, editable display name, bio, interest chips, protected
  portfolio grid, commission pricing, and an "Upgrade to Pro" banner.
- **Client** → `ClientProfilePage`: profile picture, editable display name,
  basic info, and a **My Commission Requests** board (mock posts + a "+ New
  Request" inline composer that appends a new mock post).

Both roles share one **Edit Profile** screen (`/profile/edit`): editable
name, bio/basic-info textarea, and a mock photo picker (reads a local file
into a data URL via `FileReader` — nothing is uploaded anywhere). Interest
chips are only shown/editable there for the artist role, matching the spec.
Public artist profiles reached from the Marketplace are unaffected by any of
this — they always show the artist-showcase layout regardless of the
viewer's own role.

## Theming (light default / dark)

- Light mode is the default and needs no stored preference.
- Toggle in **Settings → Appearance**. The choice is saved to `localStorage`
  (`artguard.theme`) and restored on every reload/relaunch.
- Both themes share the same Van Gogh blue (`#1D5C8C`/`#2E86C9`) + gold
  (`#E8B23D`/`#C9932A`) brand palette; only backgrounds, surfaces, borders,
  and body text swap between a clean white/alabaster set (light) and the
  mockup's deep navy set (dark). No component's markup or class names change
  between themes — only the CSS custom property values in
  `src/theme/variables.css` do, via a `data-theme="light" | "dark"`
  attribute on `<html>` (set by `src/context/ThemeContext.tsx`).

## Project structure

```
artguard-hub/
├─ capacitor.config.ts
├─ ionic.config.json
├─ src/
│  ├─ theme/
│  │  ├─ variables.css        # Light + dark design tokens (shared blue/gold brand)
│  │  └─ global.css           # All component classes (.card/.btn/.bottom-nav/.art-tile/etc.)
│  ├─ assets/
│  │  └─ icons.tsx            # Icon sprite ported from the mockup's <symbol> set
│  ├─ components/
│  │  ├─ auth/                # AuthShell, AuthInput, AuthButton, RoleToggle
│  │  └─ ui/                  # ScreenShell, BottomNav, IconButton, ArtTile,
│  │                          # SegmentedControl, ToggleSwitch, ProgressBar, MockToast
│  ├─ context/
│  │  ├─ AuthContext.tsx      # Supabase auth with localStorage mock fallback
│  │  └─ ThemeContext.tsx     # Light/dark theme, persisted to localStorage
│  ├─ data/
│  │  └─ mockData.ts          # Artists, orders, chat thread, interests list,
│  │                          # client commission requests, activity/scan/blocked logs
│  ├─ pages/                  # One file per screen (see table above)
│  ├─ routes/
│  │  ├─ AppRoutes.tsx        # Flat route table (see note below)
│  │  └─ RequireAuth.tsx      # Auth guard for protected routes
│  ├─ utils/validators.ts
│  ├─ types/auth.ts
│  ├─ App.tsx
│  └─ main.tsx
```

**Routing note:** every route is a direct `<Route>` child of a single
`<IonRouterOutlet>` (not wrapped in a nested `<Routes>`). Ionic's view-stack
manager walks the outlet's own children to build its page/transition stack,
so wrapping them would hide those children from it — this is the same
pattern Ionic's own React "tabs" starter template uses for React Router 6.

## Prerequisites

- **Node.js 18+** (20 LTS recommended) and npm
- For Android builds: **Android Studio** (SDK + an emulator or a device with
  USB debugging on)
- For iOS builds: **macOS** with **Xcode** and CocoaPods
  (`sudo gem install cocoapods`) — this is an Apple/Xcode requirement, not a
  limitation of this project

## 1. Install dependencies

```bash
cd artguard-hub
npm install
```

## 2. Run on the Web

```bash
npm run dev
```

Open the printed URL (typically `http://localhost:5173`). Resize the window
to check responsive behavior: full-bleed on phone widths, a centered
phone-proportioned card with rounded corners/glow on tablet and desktop
widths (≥768px). Every screen with content taller than the viewport scrolls
independently while its bottom nav / header stays fixed.

To preview a production build locally: `npm run build && npm run preview`.

## 3. Run on Android

```bash
npx cap add android          # one-time
npm run cap:android          # builds, syncs, opens Android Studio
```

Then pick a device/emulator and press Run in Android Studio (or
`npx cap run android` from the terminal).

## 4. Run on iOS (macOS only)

```bash
npx cap add ios              # one-time
npm run cap:ios              # builds, syncs, opens Xcode
```

Then pick a simulator/device and press Run in Xcode (or `npx cap run ios`).

## The "build → sync → open" loop

After any change to `src/`:

```bash
npm run build
npx cap sync            # copies dist/ into android/ and ios/
```

then re-run from Android Studio / Xcode, or `npx cap run android` /
`npx cap run ios`. `npm run cap:android` / `npm run cap:ios` do all three
steps in one command.


## Real multi-user backend (Supabase)

This project now supports a real Supabase backend without changing the existing UI. When
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present, ArtGuard switches from
the local mock layer to:

- Supabase Auth for separate accounts and sessions.
- `profiles` for public user profiles, roles, onboarding data, and `last_seen_at`.
- `conversations` + `conversation_participants` for persistent one-to-one chats.
- `messages` for persistent messages, reactions, attachments metadata, and read state.
- Supabase Realtime for live new-message updates and online presence.
- Public user profile screen from search, including `@username`, presence/last-seen, and a Message button.

When the environment variables are missing, the original mock/localStorage mode remains available
so the project can still be opened before the cloud backend is connected.

### Connect your Supabase project

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/schema.sql` from this project.
3. In the project settings, copy the **Project URL** and **Publishable key**.
4. Create `artguard/.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

5. Install dependencies with `npm install` (this adds `@supabase/supabase-js`).
6. For the smoothest school-demo login flow, disable email confirmation in Supabase Auth while
   testing, or keep confirmation enabled and use the email-confirmation flow before signing in.

Never put a Supabase `service_role`/secret key in the Vite client. Only use the publishable key
on the frontend; access control is enforced by Row Level Security policies in the SQL schema.

### Two-user / multi-user demo

Create at least two separate accounts. User A can search for User B from the **Messages** screen,
start a conversation, and send a message. User B can sign in from another browser/profile/device,
see the same conversation, and receive new messages through Realtime. Presence uses a shared
Realtime channel, so connected users show **Active now** and their profile falls back to labels such
as **Active 2m ago** after the last recorded heartbeat.

For an easy demo, use two browser profiles or one normal window plus one incognito window so each
browser session has its own Supabase login.

## Mock fallback and remaining prototype data

When Supabase environment variables are missing, ArtGuard Hub keeps the original
local/demo behavior so the UI can still be opened without a cloud project.
That fallback stores demo accounts in `localStorage` and intentionally is not
production-safe.

With Supabase configured, authentication, profiles, conversations, messages,
reactions/read state, and presence use the real backend. Other areas of the
prototype (commissions, marketplace seed content, protection logs, payments,
premium billing, and some upload flows) still use mock data until their own
backend pass is added.

The chat composer is wired to persistent Supabase messages in backend mode.
The existing attachment UI still stores only attachment metadata for now.

## What changed vs. the mockup

Nothing about the palette, type, spacing, cards, buttons, or icon language
was redesigned. A few things are necessary adaptations from a static
case-study mockup to a real running app:

- **No fake status bar / Dynamic Island / 308×666 phone bezel.** Those were
  presentation chrome for the mockup's portfolio grid. A real app gets a
  real OS status bar, and the responsive frame (edge-to-edge on phone,
  a centered bounded card on tablet/desktop) replaces the fixed-size bezel
  so every screen is actually usable at every width, not just one.
- **Chat and self-Profile don't render the bottom nav on their own root
  screen**, matching the mockup's screens 08 and 05 exactly (a message
  composer and a sticky "Book Commission" bar respectively occupy that
  space instead). Both are still fully reachable *from* the bottom nav on
  Home/Market/Shield — tapping "Chat" or "Profile" navigates there — this
  mirrors how most real chat apps (e.g. hiding the tab bar once you're
  inside an open conversation) handle the same tension between "a tab
  everyone can reach" and "this specific screen's own chrome."
- **Artist Profile is one component in two modes.** The mockup only showed
  it as a client's read-only view of another artist (with a "Book
  Commission" bar). The Profile tab needed a self-view too (bottom nav
  visible, an "Edit" affordance, an "Upgrade to Pro" banner, and a way into
  Settings) — same layout and classes, different footer/actions depending
  on whether `artistId` is present in the route.
- **Settings is a new screen**, since the phase-2 brief added a Light/Dark
  toggle, notifications, and account/about/sign-out — none of which existed
  in the original 10-screen mockup. It reuses the same card/row/toggle
  patterns as the rest of the app rather than inventing new ones.
- **Light/dark theming.** The mockup was dark-only. Both themes now share
  the exact same blue+gold brand tokens and the exact same component CSS;
  only the neutral background/surface/border/text tokens swap per theme
  (see `src/theme/variables.css`).
- **One new icon glyph, `eye-off`**, for the password visibility toggle
  (the mockup's password field was a static masked example and never
  demonstrated a "revealed" state to copy from). Drawn in the same
  stroke width/style as the rest of the sprite.

## Troubleshooting

- **Blank screen on Android/iOS after `cap open`**: run `npm run build`
  *before* `npx cap sync` — Capacitor copies `dist/`, so a stale/missing
  build ships stale/missing UI.
- **Theme doesn't look right on first load**: check that nothing is
  overriding `document.documentElement`'s `data-theme` attribute
  elsewhere; `ThemeContext.tsx` is the only place that sets it.
- **Fonts look off on first load**: `index.html` loads them from Google
  Fonts. For a fully offline native build, self-host the font files under
  `src/assets/fonts` and swap the `<link>` tags for local `@font-face`
  rules.
- **iOS build fails with a CocoaPods error**: run `pod install` inside the
  generated `ios/App` folder, or `npx cap sync ios` again after installing
  CocoaPods.


### Presence stability fix
The multiplayer presence channel registers all presence listeners before `subscribe()` and cleans up the channel without tracking during React/Vite remounts. Development StrictMode is disabled for this client entry to avoid duplicate subscription lifecycles that can trigger realtime callback-order errors.
