# CT Pickup — iOS / native (Expo)

Companion app for **pickup** and **esports tournaments**. It shares your Supabase email OTP login with the website and registers **Apple push** tokens via the Next.js API (Expo → APNs). There is **no Twilio/SMS** in this client.

## Setup

1. Copy env:

   ```bash
   cp .env.example .env
   ```

   Fill `EXPO_PUBLIC_SUPABASE_*` and `EXPO_PUBLIC_SITE_URL` (same values as the web app’s public vars — point `SITE_URL` at your deployed Next origin).

2. Apply the DB migration from the repo root (includes `user_push_devices`):

   ```bash
   npm run supabase:db:push
   ```

3. Install and run:

   ```bash
   npm install
   npx expo start
   ```

   Press `i` for iOS Simulator or scan the QR code with Expo Go.

## EAS Build & distribution (TestFlight / App Store)

`eas.json` defines three **build profiles**:

| Profile | Use |
|--------|-----|
| **`development`** | Custom dev client (`developmentClient: true`), **iOS Simulator** build for faster native debugging. |
| **`preview`** | **Internal** distribution (e.g. ad-hoc / internal testing) — not for the public App Store. |
| **`production`** | **App Store / TestFlight** (`distribution: "store"`), with iOS build number **auto-increment**. |

Each profile sets EAS **`environment`** (`development` / `preview` / `production`) so the matching **Environment variables** on expo.dev are injected into that build.

### One-time: link the project to Expo

From this directory:

```bash
npm install
npm run eas:login
npm run eas:init
```

`eas init` registers the app on [expo.dev](https://expo.dev), creates **`.eas/project.json`**, and may add **`extra.eas.projectId`** to `app.json` — commit those changes.

### Sync `.env` → EAS (after login + init)

From **`mobile/`**, push every **`EXPO_PUBLIC_*`** line from **`mobile/.env`** to all three default environments (**production**, **preview**, **development**):

```bash
npm run eas:push-env
```

Keys containing **`ANON_KEY`** are uploaded as **sensitive** visibility; others as **plaintext**. Re-run after changing `.env` (uses `--force` to overwrite).

Then add **`EXPO_PUBLIC_EAS_PROJECT_ID`** to `.env` if shown in the Expo dashboard and run **`npm run eas:push-env`** again so push tokens resolve in standalone builds.

### Environment variables on EAS (required for real builds)

`EXPO_PUBLIC_*` values are **baked in at build time**. They are **not** read from your laptop’s `mobile/.env` during a **cloud** EAS build unless you configure EAS to provide them.

**Set the same three public vars you use locally** for every profile you use to build (`preview`, `production`, and `development` if you build that profile):

| Variable | Purpose |
|----------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (same as web `NEXT_PUBLIC_SUPABASE_URL`). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon** public key (same as web). |
| `EXPO_PUBLIC_SITE_URL` | Production site origin, e.g. `https://ctpickup.net` (no trailing slash). |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Optional; from Expo project settings after `eas init` — helps push token registration in standalone builds. |

**Where to set them**

1. **Expo dashboard (recommended):** Project → **Environment variables** — add each name, value, and attach to the right **environment** (e.g. `production`, `preview`) and **EAS Build** scope.  
2. **CLI (alternative):** `eas env:create` / project secrets (see [EAS environment variables](https://docs.expo.dev/eas/environment-variables/)).

Do **not** commit secrets to `eas.json`; keep anon/site URLs in EAS or dashboard only.

### Commands

```bash
# iOS — TestFlight / App Store (production profile)
npm run eas:build:ios

# iOS — internal / tester builds (preview profile)
npm run eas:build:ios:preview

# Submit latest successful iOS build to App Store Connect
npm run eas:submit:ios

# Verify link + env (optional)
npm run eas:project:info

# Play Store bundle (when you’re ready)
npm run eas:build:android
```

Ensure **App Store Connect** has an app whose **bundle ID** matches `ios.bundleIdentifier` in `app.json` (`com.ctpickup.mobile` unless you change it).

## Push notifications & App Store

- **Expo Go:** push token registration may be limited; use **EAS Build** (`preview` or `production`) for reliable device push.
- Change **`ios.bundleIdentifier`** in `app.json` before shipping if needed (must match App Store Connect).
- Server-side: send notifications with **[Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/)** using tokens stored in `user_push_devices` (implement your pickup/tournament triggers in Next cron or Supabase jobs).

## Scope notes

- **Pickup:** reads `/api/pickup/public` — RSVP, waiver, and Stripe flows remain on the web until you port them here.
- **Tournaments:** lists public `esports_tournaments` rows (same as the site hub).
