# TestFlight build against the DEV backend (profile `testflight-dev`)

Goal: a TestFlight build you can test the Fields update on, that can only talk to the dev Supabase project
(`plratvhywezrtedwipsm`) and Stripe test mode. Nothing here runs `eas build` or `eas submit`; you do that by hand below.

## 1. Audit (as of this commit)

### EAS profiles (`mobile/eas.json`, `appVersionSource: local`)
| Profile | Distribution | EAS environment | Other env | Notes |
|---|---|---|---|---|
| `development` | internal (dev client) | development | `APP_VARIANT=development` | bundle id `com.ctpickup.mobile.dev`, name "CT Dev" |
| `preview` | internal | preview | none | APK on Android; no variant |
| `production` | store | production | none | **The only profile that ships to the App Store.** `autoIncrement`, submit uses `ascAppId 6766061001` |
| `testflight-dev` (new) | store | development | `APP_VARIANT=testflight-dev`, `EXPO_PUBLIC_APP_ENV=dev-testflight` | same bundle id as the real app, name "CT Dev", autoIncrement |

(The root `/eas.json` is a stray second file with `appVersionSource: remote`; run EAS only from `mobile/`.)

### Where the app gets its backend (built app, not your local file)
`mobile/.env.development.local` is **gitignored and only read by `expo start`**. A built app gets `EXPO_PUBLIC_*` values from
the **EAS environment named in the profile** (expo.dev > project > Environment variables), inlined at build time.

| Name | Read in | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `mobile/lib/supabase.ts`, `lib/env.ts` | the backend choice |
| `EXPO_PUBLIC_SITE_URL` | `lib/env.ts`, `lib/siteApi.ts` | the Next.js origin for every `/api/*` call and Stripe return pages |
| `EXPO_PUBLIC_SENTRY_DSN` | `app/_layout.tsx` | Sentry on; now tagged with `EXPO_PUBLIC_APP_ENV` |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_CTPLUS_ENABLED` | `lib/ctplus/config.ts` | CT+ stays off (leave unset) |
| `EXPO_PUBLIC_FIELDS_SAMPLE_DATA` | `lib/fields/config.ts` | ignored in release builds |
| Stripe publishable key | **not used by the app** | checkout is a server-created Checkout Session opened in the browser |

**Trap:** `mobile/scripts/eas-push-env.sh` pushes your local `.env` (production values) into the production, preview AND
development EAS environments. `testflight-dev` uses the `development` environment, so check what is in it (step A below) and
overwrite it with dev values. As a seat belt, `mobile/buildVariant.js` makes the `testflight-dev` build **fail at config time**
unless the Supabase URL host is `plratvhywezrtedwipsm.supabase.co`, the anon key's `ref` claim is the dev ref, the site URL is
https and not `ctpickup.net`, and CT+ is off. The error never prints a key or URL.

### Web deployment
Next.js on Vercel (`vercel.json` holds only three crons; crons run on Production deployments only, which is good: previews send no
scheduled pushes). `claude/fields-step1` gets a Preview deployment on push if the Vercel project is Git-connected. Stripe code
(`lib/server/stripeEnv.ts`) accepts `sk_test` keys only outside Vercel Production, so a Preview with test keys works and cannot
use them on Production by mistake. The plans routes additionally refuse any non-`sk_test_` key.

Server env vars the Preview needs (names only; set scope **Preview**, branch `claude/fields-step1` where Vercel offers it):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all DEV project)
- `NEXT_PUBLIC_SITE_URL` (the stable preview URL, no trailing slash)
- `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLANS_WEBHOOK_SECRET`, `STRIPE_PRICE_SEASON`, `STRIPE_PRICE_CONCIERGE`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_...`, optional)
- `CRON_SECRET` (any value; crons don't run on previews)
- Optional: `GOOGLE_MAPS_API_KEY` (drive times), `OPENAI_API_KEY`, `NEXT_PUBLIC_SENTRY_DSN` (leave unset so web preview errors don't hit production Sentry), `EXPO_ACCESS_TOKEN` (only if you want pushes), `MIN_APP_VERSION`/`FORCE_UPDATE_ENABLED` (leave unset), Twilio vars (leave unset; no SMS from dev).

## 2. What changed in the repo
- `mobile/eas.json`: new `testflight-dev` build profile (`distribution: store`, `environment: development`, `autoIncrement`, `APP_VARIANT`, `EXPO_PUBLIC_APP_ENV`) and a matching `submit` entry. `production` untouched (test asserts this).
- `mobile/buildVariant.js` + `mobile/app.config.js`: the `testflight-dev` variant renames the app "CT Dev" (name and `CFBundleDisplayName`) and refuses to build unless pointed at dev. Bundle id stays `com.ctpickup.mobile` so it uploads to the existing App Store Connect app. (A different bundle id would need a new ASC app, new push credentials and a new Apple App ID; say so if you'd rather.)
- `mobile/app/_layout.tsx`: Sentry `environment` = `EXPO_PUBLIC_APP_ENV` or `production`.
- Gates unchanged: Fields/Season/Events toggle, Home "Find a field", alerts, Plans and Season booking are all `isAdmin` only; non-admins see Season only and plans/Concierge "not available". `EXPO_PUBLIC_CTPLUS_ENABLED` is not set by the profile (and the build refuses if it is `true`).
- `app.json`: location strings already read "Show pickup games and soccer fields near you." (plugin and `infoPlist`). Version `1.5.0`, build number `51`.

## 3. Checklist (by hand, in order)

**A. EAS environment (expo.dev > ctpickup-mobile > Environment variables, environment = `development`)**
Run `cd mobile && npx eas-cli env:list development` first. Overwrite/create (visibility in brackets):
1. `EXPO_PUBLIC_SUPABASE_URL` = `https://plratvhywezrtedwipsm.supabase.co` [plaintext]
2. `EXPO_PUBLIC_SUPABASE_ANON_KEY` = dev anon key from Supabase dev > Project Settings > API [sensitive]
3. `EXPO_PUBLIC_SITE_URL` = the Vercel preview URL from section B [plaintext]
4. `EXPO_PUBLIC_SENTRY_DSN` = same DSN as production (the `dev-testflight` tag separates it) [plaintext]
5. Do NOT set `EXPO_PUBLIC_CTPLUS_ENABLED`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY` or `EXPO_PUBLIC_FIELDS_SAMPLE_DATA`.
Do not run `eas-push-env.sh` for this.

**B. Vercel preview**
1. Vercel project > Settings > Git: confirm the repo is connected; push of `claude/fields-step1` makes a Preview deployment.
2. Settings > Environment Variables: add the names above, scope **Preview** (limit to branch `claude/fields-step1`).
3. Settings > Deployment Protection: turn **Vercel Authentication OFF for Preview** (or the phone gets a login wall on every `/api` call). The preview URL is public, so keep it unlisted.
4. Use the stable branch alias (`<project>-git-claude-fields-step1-<team>.vercel.app`) as `NEXT_PUBLIC_SITE_URL` and `EXPO_PUBLIC_SITE_URL`, not the per-deployment URL. Redeploy after setting variables. Open `<url>/api/app-version` in Safari to confirm it answers.
5. Stripe Dashboard (TEST mode) > Developers > Webhooks: add endpoint `<url>/api/stripe/plans-webhook`; its signing secret is `STRIPE_PLANS_WEBHOOK_SECRET`. Add `<url>/api/stripe/webhook` if you test tournament checkout (`STRIPE_WEBHOOK_SECRET`).
6. Dev database: migrations through `20261023*` applied, plus `scripts/dev/dev_pickup_runs_stub.sql` (see `docs/dev-environment.md`).

**C. Build and submit (from `mobile/`)**
```
cd mobile
npx eas-cli whoami
npx eas-cli build --profile testflight-dev --platform ios
npx eas-cli submit --profile testflight-dev --platform ios --latest
```
`eas build` prints the config-time refusal if the env is wrong; fix section A, don't bypass.
`autoIncrement` with `appVersionSource: local` edits `mobile/app.json` `buildNumber` on your machine; commit that change so the next build continues from it. Production builds share the same counter, so never reuse a number.

**D. Add yourself as an internal tester**
App Store Connect > Users and Access: your Apple ID must have a role (Admin / App Manager / Developer / Marketing). Then app CT > TestFlight > Internal Testing > "+" > create a group, enable "automatic distribution" if you like, add yourself. After processing (10-30 min) answer the export-compliance prompt if shown (the app sets `ITSAppUsesNonExemptEncryption: false`, so it should not be). Install the TestFlight app on the phone, accept the invite email. Internal builds need no Beta App Review.

## 4. What could make Apple reject or the build fail
- **Version train:** if `1.5.0` is already approved/live, App Store Connect refuses new uploads for it ("train closed"). Check ASC; if so bump `version` in `mobile/app.json` (e.g. 1.6.0) before building. Build number must be higher than every previous upload of that version (counter above).
- **Privacy strings:** present for location, contacts, camera, photos, Face ID. No microphone/tracking. Fine.
- **Push:** `expo-notifications` adds the `aps-environment` entitlement; the existing App ID/provisioning from production builds is reused because the bundle id is unchanged. EAS prompts for Apple login on first build.
- **Sentry plugin:** source-map upload needs `SENTRY_AUTH_TOKEN` in the EAS environment (same as production builds today). If production builds work without it, this one will too; otherwise set `SENTRY_ALLOW_FAILURE=true` or the token.
- **HTTP:** `EXPO_PUBLIC_SITE_URL` must be https (the build refuses http).
- **Review:** TestFlight internal testing is not App Review. Nothing here touches review submission. The Fields features are admin-only in this build, so no new IAP/payments surface appears to non-admin users; when you later open them, the Stripe-for-physical-services position (no Apple IAP) is in `docs/fields-release-checklist.md`.
- Two apps named "CT" and "CT Dev" share one bundle id: installing the TestFlight build over an App Store install replaces it on that phone. Use a phone without the real app, or accept that you reinstall it after.

## 5. Accounts and testing
Only accounts that exist in the **dev** Supabase Auth can sign in; production users cannot. That is the admin user you created per `docs/dev-environment.md` (Dashboard > Auth > Users, then `scripts/dev/fields_dev_admin.sql`), and any others you add the same way. Use "Sign in with password" (email codes depend on dev SMTP limits). The dev `profiles` table is a stub, so Games/Messages/Profile screens outside Fields may be empty or error; that is the dev DB, not the build.

Check on the phone, signed in as the dev admin:
1. Admin tab bottom line: "Database: plratvhywezrtedwipsm.supabase.co". If it shows anything else, delete the build.
2. Games > Fields: list, map sheet, search, filters, Use my location (permission text), field page, directions, last-confirmed.
3. Request a field (as admin), Suggest a field, Report a problem; My requests; Admin: record the reply, Remove/Merge/Restore.
4. Create a game from a field and from an approved request; game page shows the field link.
5. Plans > Season ($39) and Concierge with card 4242 4242 4242 4242 in the browser checkout; confirm the plan row appears via the preview webhook.
6. A second, non-admin dev user (create one in the dashboard): no Fields toggle, no plans.
7. Force an error you can recognise and confirm it lands in Sentry with environment `dev-testflight`.
