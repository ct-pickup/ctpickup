# Remote feature flags (Fields and paid plans)

Two switches, both OFF until you turn them on, change without a new app build:

| Key | Controls |
|---|---|
| `fields` | The Fields tab/toggle, "Find a field" on Home, field alerts, requests, suggestions, reports, "Create a game here", season booking |
| `paid_plans` | Plans screen, Concierge, Book my season checkout. Also needs `fields` on |

A flag is **ON for a user** when it is switched on for everyone, **or** the user's id is on its allowlist, **or** the user is an admin. Anything else is OFF, including a missing row, a signed-out user and any read error.

## Where it is enforced
- **Database** (`supabase/migrations/20261024000000_app_flags.sql`): `app_flags`, `app_flag_events` (the change log; there was no general admin audit table, so this one is new), `flag_on(key, uid)`, `my_flags()`. Direct writes that the app makes with the player's own login (request insert, suggestion insert, "looks right", saved fields, field alerts) now require `flag_on('fields')` in their RLS policies, so an old app build cannot bypass the switch. Reads of public venue data stay open.
- **Server** (`lib/flags.ts`): `/api/fields/requests`, `/api/fields/report`, `/api/plans/checkout` (needs both flags) and `/api/sessions/create` when it carries a `venue_key` or `venue_request_id` answer **403 `{ "error": "feature_off" }`** when the flag is OFF for the caller. Games without a field never look at the flags. The Stripe plans webhook is exempt (payments already taken must still be recorded). The admin routes (replies, undo, suggestions, calendars, flags) were left alone on purpose: they already require an admin and admins are always ON, so a flag check there could never fire.
- **App** (`mobile/lib/flags.ts`, `mobile/context/FeatureFlagsContext.tsx`): reads `my_flags()` at launch, when the user changes and when the app returns to the foreground (cached 60 s, failures never cached). If the answer cannot be read the flags are OFF; admins stay ON (the same `is_admin` the app already trusts). Replaces the old admin-only checks for the Season/Fields/Events toggle, Home "Find a field", field alerts, Plans, Book my season, and the "Plans ›" line (that one needs `paid_plans`). Admin-only things that are not the feature itself (admin tab, the admin notes card on a field, admin push routing) still check admin.
- **Admin screen**: Admin tab → More → **Feature flags**. A switch per flag ("on for everyone", with a confirmation), an allowlist with an email box (resolved to a user id on the server) and a Remove link, and the last 20 changes (who, what, when).

## Run the migration on DEV (never production)
1. Confirm you are on the dev project (`plratvhywezrtedwipsm`) and that `20261012…`–`20261023…` and `scripts/dev/dev_pickup_runs_stub.sql` are already applied.
2. Either paste `supabase/migrations/20261024000000_app_flags.sql` into the dev dashboard SQL Editor and Run, or from the repo root:
   `psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261024000000_app_flags.sql`
3. Check: `select key, enabled, allowlist from public.app_flags;` shows `fields` and `paid_plans`, both `false`, empty allowlist.
4. Rollback is the commented block at the bottom of the file.

Heads-up for dev: once this runs, a non-admin dev user can no longer use Fields until you switch `fields` on or add them to its allowlist. Admins are unaffected.

## Test checklist (dev build or `expo start`, with the Next server against dev)
1. As **admin**: Admin → More → Feature flags opens; both switches off, allowlist empty. Fields toggle, Find a field and Plans still work for you.
2. As a **plain dev user** (not admin), flags off: no Season/Fields/Events toggle, no "Find a field" on Home, no field alerts, `/plans` and `/season-book` say "Plans aren’t available yet." (same as before this change).
3. In the admin screen add that user's email to **Fields** → Add. On the plain user's phone, background and reopen the app (or wait a minute): the toggle and "Find a field" appear; browsing, request, suggest, report, save, alerts work. Plans still hidden.
4. Add the same email to **Paid plans**: "Plans ›" line appears, `/plans` opens, a test-card checkout (4242…) works. Remove them from Paid plans: gone again on the next foreground.
5. Switch **Fields** on for everyone (confirm dialog): a second plain user sees it too. Switch it off: gone on the next foreground; the allowlisted user keeps it.
6. Server bypass attempts (token of a plain user, flag off), expect `403 {"error":"feature_off"}`: `POST /api/fields/requests`, `POST /api/fields/report`, `POST /api/plans/checkout`, `POST /api/sessions/create` with `venue_key`. With the flag on the same calls work.
7. Direct write bypass (old build): with Fields off, a plain user inserting into `venue_suggestions`, `saved_venues` or `alert_subscriptions` is refused by RLS; deleting their own saved fields still works.
8. Break it: turn off the dev API / airplane mode before launching; a plain user sees Fields hidden, an admin still sees it. Rename `my_flags` temporarily (or run the app before the migration): plain user sees Fields hidden (fails closed).
9. The change log at the bottom of the Feature flags screen lists each toggle and allowlist change with your email.
