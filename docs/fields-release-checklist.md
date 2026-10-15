# Fields release checklist (production)

Written as an audit of branch `claude/fields-step1`. **Nothing here has been run against production or any database.** Every SQL
snippet below is for you to paste into the Supabase SQL Editor yourself, read-only unless it says otherwise. Dev project ref
`plratvhywezrtedwipsm` is dev only; production is a different project.

Status of the code: tsc, ESLint, vitest and check-theme are at their baselines on this branch. The Fields migrations have only been
parse-checked (pglast) and applied by you on dev. They have never touched production.

---

## 1. Migrations, in order, and what they depend on

### 1.1 Fields migrations (apply in this exact order, never skip one)

| # | File | What it does | Rollback |
|---|------|--------------|----------|
| 1 | `20261012000000_fields_venues_schools.sql` | `schools`, `venues` (+ RLS: signed-in read, admin write), first `upsert_schools` / `upsert_venues` | drop tables (data loss) |
| 2 | `20261012000100_fields_requests_events_slots.sql` | `venue_requests`, `events`, `schedule_slots`, `venue_calendars`, `connected_venue_keys()`, `venue_calendar_connected()`, `fields_touch_updated_at()` | drop tables |
| 3 | `20261012000200_fields_alerts_saved.sql` | `alert_subscriptions`, `saved_venues` | drop tables |
| 4 | `20261013000000_fields_upsert_preserve_manual.sql` | `upsert_venues` keeps price/permit/booking on verified or manual rows | re-run #1's function |
| 5 | `20261013000100_venue_requests_guards.sql` | one open request per slot, rate limits on requests | drop the trigger / index |
| 6 | `20261014000000_venues_setting.sql` | `venues.setting` (indoor / outdoor / both), `upsert_venues` keeps it | drop column |
| 7 | `20261015000000_plans.sql` | `plan_subscriptions`, `my_plan_status()`, `record_plan_request_usage()`, plan columns on `venue_requests` | drop tables / columns |
| 8 | `20261016000000_plans_v2_season.sql` | `plan_catalog`, `season_purchases`, season columns | drop tables / columns |
| 9 | `20261017000000_venues_nearby.sql` | `venues_nearby()` (the map and list query) | drop function (the Fields list stops working) |
| 10 | `20261018000000_venue_suggestions.sql` | `venue_suggestions`, `venue_confirmations`, `venue_confirmation_counts()`, `venues.source / locked_fields / player_notes`, `upsert_venues` honours `locked_fields` | block at the end of the file |
| 11 | `20261019000000_venues_source_manual.sql` | allows `venues.source = 'manual'` | re-add the old check |
| 12 | `20261020000000_locked_field_groups.sql` | `locked_fields` may hold `price` / `permit` / `booking`; replaces `upsert_venues` (copy of #10 plus groups) | re-run #10's function |
| 13 | `20261021000000_venue_replies.sql` | `venue_replies`, `venue_data_events` (audit log), `venues.residency_rule / availability_notes / contact_text` | block at the end of the file |
| 14 | `20261022000000_venue_reports.sql` | `venues.status / closed_until / merged_into / ...`, new report reasons, `venues_nearby()` returns active venues only, `upsert_venues` skips removed / hidden rows | block at the end of the file |

Notes that matter when applying:
- **#12 and #14 each replace `upsert_venues` and #14 also replaces `venues_nearby`.** They are copies of the previous versions plus
  one change, so they must be applied in order. Applying #14 without #12 (or #9) would silently drop behaviour.
- All are additive (`create ... if not exists`, `add column if not exists`). None deletes or rewrites existing rows.
- Dev-only files that must never run on production: everything in `scripts/dev/` (`fields_stub_tables.sql`, `fields_sample_*.sql`,
  `fields_dev_admin.sql`, `fields_indoor_venues.sql`, `fields_sample_suggestions.sql`). `fields_stub_tables.sql` creates a stand-in
  `profiles` table and would **conflict with the real one**.

### 1.2 Things the Fields code relies on that no Fields migration creates

These exist in the real app's earlier migrations (or outside SQL). Dev only has stubs for the first two. **Verify each on production
before applying anything.**

| Needed by | Object | Created by | Verify on production |
|-----------|--------|------------|----------------------|
| every Fields RLS policy, all admin checks | `public.profiles` with columns `id`, `is_admin`, `approved`, `first_name`, `last_name`, `username` | `20260408120000_profiles_schema.sql` (+ later) | table exists and has those columns |
| every admin policy | `public.is_admin_uid(uuid)` | `20260503193000_chat_room_controls.sql` | function exists, returns true for an admin |
| all user-owned tables | `auth.users` | Supabase | n/a |
| player push when a request changes | `public.user_push_devices` | `20260501140000_user_push_devices.sql` | table exists |
| rate limits on Fields API routes | `api_rate_limit_check` RPC | `20260520140000_api_rate_limit_buckets.sql` | function exists |
| `gen_random_uuid()` in every table default | Postgres 13+ built-in | Supabase | `select gen_random_uuid();` works |
| Stripe plans | Stripe products, prices, webhook endpoint | **not SQL** (Stripe Dashboard) | see section 3 |
| the map | rows in `venues` | importers (`scripts/import-venues.ts`, `import-ct-venues.ts`, `import-research.ts`) | production `venues` is empty until you run them |
| season / Games tab (not Fields itself) | `pickup_runs`, `pickup_run_rsvps`, `pickup_run_results`, `tier_sessions`, ... | the app's baseline schema; **not in `supabase/migrations/`** for some of them | production already runs the app, so they exist. Do not use the dev stubs as a guide |

Read-only preflight (paste in the **production** SQL Editor; none of these change anything):

```sql
-- 1. The baseline the Fields migrations assume
select to_regclass('public.profiles')            as profiles,
       to_regclass('public.user_push_devices')   as user_push_devices,
       to_regprocedure('public.is_admin_uid(uuid)') as is_admin_uid,
       to_regprocedure('public.api_rate_limit_check(text,text,integer,integer)') as rate_limit_fn;   -- adjust args if yours differ
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('id','is_admin','approved','first_name','last_name','username');            -- expect 6 rows

-- 2. Nothing named like a Fields table already exists with a different shape
--    (create table if not exists would silently skip it)
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('venues','schools','venue_requests','events','schedule_slots','venue_calendars','alert_subscriptions','saved_venues',
                      'plan_subscriptions','plan_catalog','season_purchases','venue_suggestions','venue_confirmations','venue_replies','venue_data_events');
-- expect: no rows

-- 3. Which migrations are recorded as applied (if you use the Supabase CLI)
select version from supabase_migrations.schema_migrations order by version desc limit 20;

-- 4. Is anyone who should be an admin an admin?
select count(*) as admins from public.profiles where is_admin;
```

Also do these **before** the real run:
1. Take a backup / confirm point-in-time recovery is on (Supabase Dashboard > Database > Backups).
2. Apply all 14 migrations to a **production clone or a Supabase branch** first and run the dev checks again. Dev was built from
   stubs, so a clean run on a copy of real production data is the only proof the real `profiles` / `is_admin_uid` behave as the stubs do.
3. Confirm the Supabase CLI is linked to the production project only when you mean it (`npx supabase projects list`). The repo's
   `npm run supabase:db:push` pushes **every** unapplied migration, including any non-Fields ones; check `supabase migration list` first.

---

## 2. Replacing the admin gates with one remote feature flag

### 2.1 Where Fields is gated to admins today

Client (all use `useProfileAdmin().isAdmin`):

| File | Gate | Notes |
|------|------|-------|
| `mobile/app/(tabs)/sessions.tsx:95-100,160` | the Season / Fields / Events toggle only renders for admins; non-admins are forced to `view = "season"` | main entry |
| `mobile/app/(tabs)/index.tsx:383,501` | Home "Find a field" row | second entry |
| `mobile/app/notifications.tsx:27,136` | `AlertSettings` (field alerts) | |
| `mobile/app/plans.tsx:33,58` | Plans screen shows "not available" | separate flag, see 2.3 |
| `mobile/app/season-book.tsx:30,82` | Season booking screen | separate flag |
| `mobile/lib/pushRouting.ts:9-17`, `mobile/components/PushTapRouter.tsx` | tapping an admin push opens the admin queue | **stays admin**: it is the admin queue, not the feature |
| `mobile/app/field/[id].tsx:24,154` | admin-only notes card | **stays admin** |
| `mobile/app/(tabs)/admin/*` | admin screens | **stay admin** (`admin/_layout.tsx` redirects non-admins) |

Not gated at all (reachable by deep link or direct call by any signed-in user, even today): `mobile/app/field/[id].tsx`,
`field-request.tsx`, `field-requests.tsx`, `suggest-field.tsx`, `report-problem.tsx`, `field-schedule.tsx`, the `venues_nearby`
RPC, the RLS inserts on `venue_requests` / `venue_suggestions` / `venue_confirmations`, and `POST /api/fields/report`.

Server:

| File | Gate |
|------|------|
| `app/api/plans/checkout/route.ts:33-35` | `profiles.is_admin` or 403 ("Plans aren't available yet") |
| `app/api/stripe/plans-webhook/route.ts` | none (Stripe-signed) |
| `app/api/admin/**` | `requireAdminBearer` (**stays**) |

So today "admin-only" is a UI convention; the database does not enforce it for anything except plans checkout.

### 2.2 Plan (not implemented)

Goal: one switch in the database that turns Fields on for nobody, a list of users, or everyone, with an instant off.

1. **Table `app_flags`** (new migration): `key text primary key`, `enabled boolean not null default false`, `mode text not null default 'off'
   check (mode in ('off','admins','list','everyone'))`, `user_ids uuid[] not null default '{}'`, `updated_at`, `updated_by`.
   RLS: any signed-in user may `select` (the app must read it); only admins may write. Seed two rows: `fields` and `fields_plans`, both `off`.
2. **Function `flag_on(p_key text, p_uid uuid default auth.uid()) returns boolean`**, `security definer`, `stable`: admins always true;
   `everyone` true; `list` true if `p_uid = any(user_ids)`; else false. One function used by the app (via RPC) and by RLS.
3. **Client hook `useFeatureFlag('fields')`** in `mobile/hooks/`: calls the RPC, caches in memory for 60 s, refetches on app foreground and
   on every Fields screen mount, fails **closed** (off) on error. Replaces each `isAdmin` check in the client table above (rows marked
   "stays admin" keep `isAdmin`). Deep-linked Fields screens redirect Home when the flag is off.
4. **Server enforcement** so the off switch is real: `POST /api/fields/report`, the plans routes, and RLS `with check (flag_on('fields'))`
   on the inserts for `venue_requests`, `venue_suggestions`, `venue_confirmations`, `saved_venues`, `alert_subscriptions`; and
   `venues_nearby()` returns nothing when the caller's flag is off. This is what makes "instant off" work even for old app builds.
5. **Two flags**: `fields` (browse, request, suggest, report) and `fields_plans` (Season $39 / Concierge). Ship `fields` first;
   keep `fields_plans` off until the Apple question in section 4 is settled.
6. **Admin control**: a small row in the admin menu ("Fields: Off / Admins / List / Everyone") plus a list editor, writing `app_flags`
   through an admin-only API route. Log changes to `venue_data_events`-style audit (who flipped it, when).
7. **Tests**: `flag_on` truth table (off, admins, list, everyone, non-listed user), hook fails closed, RLS insert refused when off.

Files to touch: new migration; `mobile/hooks/useFeatureFlag.ts`; `sessions.tsx`, `index.tsx`, `notifications.tsx`, `plans.tsx`,
`season-book.tsx`, and the unguarded Fields screens listed above; `app/api/plans/checkout/route.ts`, `app/api/fields/report/route.ts`;
admin menu + one admin API route; docs.

Rollback of the flag work itself: it is additive. With the table absent the hook fails closed (off), so removing the migration
turns Fields off, not on.

---

## 3. Environment variables and secrets for production

| Variable | Used by | Set where | Notes |
|----------|---------|-----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | web + API routes | Vercel project env (Production) | production project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web + API routes | Vercel (Production) | public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | every `/api/admin/*`, `/api/fields/report`, plans routes, webhook | Vercel (Production), **server only, never `NEXT_PUBLIC_`** | rotate if it was ever pasted into a chat or log |
| `NEXT_PUBLIC_SITE_URL` | Stripe return URLs, server self-fetch | Vercel (Production) | `https://your-domain.com`, no trailing slash; also set Supabase Auth Site URL / redirects |
| `EXPO_PUBLIC_SUPABASE_URL` | mobile | EAS environment `production` (expo.dev > Project > Environment variables) | baked into the build |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile | EAS `production` | |
| `EXPO_PUBLIC_SITE_URL` | mobile calls the API (`siteOrigin()`): reports, replies, admin screens, checkout | EAS `production` | **must be the production API origin**; a dev tunnel here breaks every Fields write |
| `STRIPE_SECRET_KEY` | checkout, webhooks | Vercel (Production) | **`sk_live_...`. Blocked in code today**: `assertPlansTestKey()` in `lib/plans/stripePlans.ts` throws unless the key starts `sk_test_`. Plans cannot work in production until that guard is changed on purpose |
| `STRIPE_PRICE_SEASON` | Season checkout | Vercel (Production) | the **live-mode** Price id (`price_...`), created in Stripe live mode |
| `STRIPE_PRICE_CONCIERGE` | Concierge checkout | Vercel (Production) | live-mode recurring Price id |
| `STRIPE_PLANS_WEBHOOK_SECRET` | `/api/stripe/plans-webhook` | Vercel (Production) | `whsec_...` of a **live-mode** endpoint pointing at `https://<domain>/api/stripe/plans-webhook`; separate from `STRIPE_WEBHOOK_SECRET` |
| `STRIPE_WEBHOOK_SECRET` | existing tournament / pickup webhook | Vercel | already in production; do not reuse for plans |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | only if Stripe.js is added | Vercel | not used by Fields (Checkout is a hosted page) |
| `EXPO_ACCESS_TOKEN` | push (`sendPushToUsers`) | Vercel | already needed by existing pushes |
| `CRON_SECRET` | Vercel crons | Vercel | existing |
| `CT_PROD_SUPABASE_HOSTS` | **your laptop** when running importers | shell only | comma list of production hosts the importers refuse unless `--allow-prod` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | importers (`scripts/import-*.ts`) | shell only, per run | never commit, never print |
| `EXPO_PUBLIC_FIELDS_SAMPLE_DATA` | dev bundle only (`__DEV__`) | **must be unset** in EAS production | ignored in release builds, but keep it out |
| `EXPO_PUBLIC_CTPLUS_ENABLED`, `EXPO_PUBLIC_SEASON_PRIZE_ENABLED`, `EXPO_PUBLIC_CONTACTS_INVITE_ENABLED`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_SENTRY_DSN` | other features | EAS `production` | unchanged by Fields |

Stripe live-mode setup (Dashboard, live mode): create the two Products with prices matching `shared/fields/plans.ts` ($39 one-time,
$29.99/month), tag them as the code expects (`PLAN_PRODUCT_TAG` / `SEASON_PRODUCT_TAG` in `lib/plans/stripePlans.ts`), add the webhook
endpoint for the events the handler subscribes to, copy the signing secret.

---

## 4. App Store / Play submission items affected

1. **Location permission string** (`mobile/app.json` iOS `NSLocationWhenInUseUsageDescription` and the `expo-location` plugin
   `locationWhenInUsePermission`): currently "Show pickup sessions near you." Fields also uses location to centre the map, sort fields by
   distance, and for "Use my location" in Suggest a field. Update both strings, for example: "Show pickup games and fields near you,
   and centre the map where you are." Apple rejects strings that do not describe the actual use. Both places must match.
2. **Privacy nutrition label (App Store Connect > App Privacy)**: location is already declared for pickup. Confirm "Precise Location"
   (the map and "Use my location" read precise coordinates) is ticked, purpose "App Functionality", not used for tracking. Add or confirm
   **User Content** (field suggestions, reports, notes, photos if any) as "App Functionality", linked to the user. Purchases (Season /
   Concierge) are handled by Stripe; confirm "Purchases" is declared if you keep plans in the build.
3. **Google Play Data safety** (the Android build exists, `versionCode: 3`): same declarations (approximate and precise location, user content).
4. **OpenStreetMap attribution (ODbL)**: shown today as "Venue data © OpenStreetMap contributors" at the bottom of the Fields list
   (`FieldsPanel.tsx`). The licence expects attribution wherever the data is shown, so also add it to the field detail screen and the
   Suggest a field map. Apple Maps / Google Maps have their own attribution already (react-native-maps renders it).
5. **Terms and privacy links**: the web pages are `app/privacy/page.tsx` and `app/terms/page.tsx`. Update them to cover: field
   suggestions and reports (user-generated content, admin review, removal), location use for the map, the Season / Concierge
   services (what is sold, refunds, that CT requests access from venues but cannot guarantee it), and data from OpenStreetMap and
   venues. Confirm the in-app links (Settings) point to the updated pages and that the App Store Connect privacy URL matches.
6. **Stripe Checkout for real-world services**: plans open Stripe in `WebBrowser.openBrowserAsync` (`plans.tsx:49`,
   `season-book.tsx:74`). Apple allows external payment for **goods and services consumed outside the app** (guideline 3.1.3(e)); it
   does not allow it for digital features. "Book my season" ($39, we request a venue for 8+ weeks) is a real-world service. **Concierge**
   ($29.99/month, "4 requests a month") reads like an in-app entitlement and is the most likely thing a reviewer treats as digital
   content that requires In-App Purchase. Safest path for the first release: ship Fields with the `fields_plans` flag **off**, keep the
   free "Do it yourself" tier, and add the paid plans in a later update with explicit App Review notes (a human arranges the
   booking; nothing unlocks inside the app). Never mention Apple or IAP in the plan copy.
7. **User-generated content (guideline 1.2)**: suggestions and reports are reviewed by an admin before anything appears. Mention that in
   the review notes; keep the report flow and the hide-after-3-reports rule.
8. **Demo account for App Review**: give them a signed-in account that can see Fields (flag on for that user) and say where the paid
   flow is, or that it is off.
9. **App config for a new version**: `mobile/app.json` `version` 1.5.0 to the new version (1.6.0); `ios.buildNumber` is 51 and
   `eas.json` has `autoIncrement: true` with `appVersionSource: local`, so confirm EAS bumps it, or set it yourself; Android
   `versionCode` 3 likewise. `expo-location` is already in `plugins`, so no new native module is needed for Fields; confirm with
   `npx expo-doctor` and a fresh `eas build --profile production`. The `expo-sdk-upgrade` branch is separate; decide merge order
   before building so the store build comes from one branch.
10. **Review notes**: explain that venue data is crowd-sourced and from OpenStreetMap, that nothing is booked inside the app, and how
    to find Fields.

---

## 5. Production rollout, in order, with a rollback for each step

Rule: every step is reversible until step 7. Do not start the next step until the previous one is verified.

| Step | Do | Verify | Rollback |
|------|----|--------|----------|
| 0 | Merge `claude/fields-step1` into the release branch (not `main` directly if you gate releases) after you review it. Keep `expo-sdk-upgrade` out of the same release unless decided. | CI green | revert the merge |
| 1 | Backup: confirm PITR / take a snapshot of production | snapshot exists | n/a |
| 2 | Run the preflight SQL (section 1.2) on production | all rows as expected | stop; fix baseline first |
| 3 | Rehearse: apply all 14 migrations to a production clone / Supabase branch; run the dev test steps | everything works on real `profiles` | delete the branch |
| 4 | Apply the 14 migrations to production, **one file at a time**, in order, in the SQL Editor | after each, run its check query (tables / columns exist); at the end `select count(*) from venues;` = 0 | per-file rollback blocks (section 1.1); or restore the snapshot. Nothing is dropped, so partial application is safe to stop at |
| 5 | Create the flag table and set `fields` = off (see section 2; **do this before any app code goes live**) | `flag_on('fields')` false for a non-admin | drop table (hook fails closed) |
| 6 | Deploy the web / API to Vercel with the new env vars (section 3). Plans routes stay unusable without live Stripe config, which is correct while `fields_plans` is off | open `/api/fields/report` unauthenticated: 401; admin routes: 401/403 | Vercel: promote the previous deployment |
| 7 | Load venues. Dry run first, from your laptop: `node --experimental-strip-types scripts/import-venues.ts --db <snapshot> --states CT --dry-run`, then the same without `--dry-run` plus `--expect-host <prod-host>` and `--allow-prod`. One state first, then the rest. Then `import-research.ts` dry run, review the CSV, then `--apply` | counts match the dry run; open a few fields in a query | before any request exists: `delete from venues where source = 'osm' and venue_key like '<state prefix>%'` for that batch (requests restrict deletes, so after launch use `status = 'removed'` instead). Or restore the snapshot |
| 8 | Make yourself the first user: confirm `profiles.is_admin = true` for the admins; set the flag to `admins`; walk through Fields as an admin on the TestFlight build | map, search, request, suggest, report, admin queue, reply, undo | set the flag to `off` |
| 9 | Update `app.json` strings and version (section 4), build with EAS production, upload to TestFlight, test on a real phone with the production API | permission prompt text, attribution, report flow | do not submit; fix and rebuild |
| 10 | Submit for review with the notes (section 4) | approved | withdraw the submission / reject the build in App Store Connect |
| 11 | Staged turn-on: flag `list` (5-10 testers) then `everyone`, watching Sentry, Supabase logs, and the admin queue | no error spikes; suggestions arrive; auto-hide not firing unexpectedly | flag back to `list` / `off` instantly (the server enforces it) |
| 12 | Later, separately: plans. Change the test-key guard on purpose, create live Stripe products, add the webhook, then turn `fields_plans` on for admins only | one real test purchase by an admin, refund it | `fields_plans` off; cancel in Stripe |

After launch: check weekly the `hidden_pending_review` list and the Field suggestions count (it is now in the admin Needs-attention list).

---

## 6. The riskiest five items

1. **Paid plans and Apple / Stripe.** The plans code refuses live Stripe keys (`assertPlansTestKey`) and the server gate is `is_admin`. Even once
   fixed, Concierge (a monthly subscription for "requests") is the item most likely to be rejected as an in-app entitlement that needs
   In-App Purchase. Ship Fields first with plans off behind their own flag.
2. **The migrations have never run on production.** Dev was built on stub `profiles` / `is_admin_uid`. `create table if not exists` can
   silently skip a pre-existing table, and #12 / #14 replace `upsert_venues` and `venues_nearby`, which every Fields screen and every
   importer depend on. Rehearse on a production clone and apply one file at a time with a snapshot taken first.
3. **The admin gate is only in the app.** Anyone signed in can already call the `venues_nearby` RPC, post a field request or suggestion
   through RLS, and call `/api/fields/report`. A client-side flag would not stop old builds or direct calls, so the "instant off" needs
   the server / RLS enforcement in section 2.2 before launch.
4. **Notifications that promise things nothing sends.** Alert toggles exist for `slot_opens`, `new_games`, `changes_cancellations` and
   `weekly_roundup`, but the only alert with a sender is `request_updates`. Either hide the others at launch or build the jobs; also no
   Fields cron exists in `vercel.json`. Pair this with the stale location string ("Show pickup sessions near you"), which does not
   describe the map and is an easy review rejection.
5. **Data quality and licence of the production load.** The nationwide OpenStreetMap import will put tens of thousands of fields on the
   map, many private, closed or not soccer. Mitigations exist (3-report auto-hide, removal that imports respect, research overlays, `locked_fields`),
   but they are untested at scale, and the ODbL attribution is on the list footer only. Load one state first, review a sample on
   the phone, and add attribution to the detail and suggest screens before launch. Importers also touch production only with
   `--allow-prod --expect-host`; never run them without the dry run first.

Also worth knowing: `docs/dev-environment.md` is the dev-only setup guide and is not a production runbook.
