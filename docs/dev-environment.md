# Running the app against the dev Supabase project

Dev project: `ctpickup-dev`, ref `plratvhywezrtedwipsm`. Nothing here touches production. The files below are gitignored.

## One-time database setup (dev only)
Apply in this order with `psql` (or the dashboard SQL editor):
1. `scripts/dev/fields_stub_tables.sql` (stub `profiles`, `is_admin_uid`)
2. `supabase/migrations/20260407160000_user_waiver_acceptance.sql` (the waiver gate reads this table)
3. the fields migrations `20261012*` and `20261013*`, in filename order
4. CT data (`scripts/import-ct-venues.ts`) and the sample seeds (`scripts/dev/fields_sample_*.sql`)

## Create your admin user
1. Dashboard > Authentication > Users > Add user > Create new user. Email + password, tick Auto Confirm User.
2. Run `scripts/dev/fields_dev_admin.sql` with your email (it creates the profile and the waiver row).

## Point the app at dev
1. `cp mobile/.env.development.local.example mobile/.env.development.local`, fill in the dev anon key.
2. For the request, waiver and push APIs run the Next server against dev: `cp .env.development.local.example .env.development.local`, fill in the dev keys, `npm run dev`.
3. `cd mobile && npx expo start -c`. Sign in with "Sign in with password".
4. Check: Admin tab > bottom line "Database: plratvhywezrtedwipsm.supabase.co".

## Switch back
Delete (or rename) both `.env.development.local` files, stop the Next server, restart `npx expo start -c`. The Admin tab line must show the production host.
Do not run `eas build` / `eas update` while these files exist.

## Fields plans in Stripe test mode (dev only)
Needs migrations `20261015000000_plans.sql` then `20261016000000_plans_v2_season.sql` applied to dev, and `STRIPE_SECRET_KEY=sk_test_...` in the root `.env.development.local`.
1. Stripe Dashboard, test mode ON. Product catalog: create "Book my season" with ONE-TIME price $39, and "Concierge" with a RECURRING MONTHLY price $29.99. Copy each price id (`price_...`).
2. Root `.env.development.local`: `STRIPE_PRICE_SEASON`, `STRIPE_PRICE_CONCIERGE`, `STRIPE_PLANS_WEBHOOK_SECRET` (below).
3. Webhook: run `stripe listen --forward-to localhost:3000/api/stripe/plans-webhook` (Stripe CLI) and use the `whsec_...` it prints as `STRIPE_PLANS_WEBHOOK_SECRET`. Restart `npm run dev`.
4. In the app (admin): Games > Fields > Plans. Season: pick field, day, time, length, weeks, then pay. Concierge: Choose Concierge. Test card 4242 4242 4242 4242, any future date, any CVC, any ZIP.
Prices shown in the app are in `shared/fields/plans.ts` (one file). The plans routes refuse a live key (`sk_live_`) and non-admin users. Never use live keys here.

## Dev database created before the `events` rename
The Fields events table is now `public.field_events` (production has an unrelated `public.events`). A dev database that already ran the old
`20261012000100` migration has the table under the old name: run `scripts/dev/rename_fields_events.sql` once (SQL Editor or
`psql "$DEV_DATABASE_URL" -f scripts/dev/rename_fields_events.sql`). It is idempotent, refuses to rename a table that lacks the Fields
columns, and finishes with a read-only listing of the renamed objects. Then re-run `scripts/dev/fields_sample_schedule.sql` if you want the
sample events (it now writes `field_events`). A fresh dev database just runs the migration as it is now.
