# Production drift check (read-only)

Production (`txsagoaqnohdnykweslc`) records migrations only up to `20260523120000`, and has these of the tables we looked at:
`profiles`, `pickup_runs`, `pickup_run_rsvps`, `user_push_devices`; functions `is_admin_uid(p_uid uuid)` and
`api_rate_limit_check(p_bucket_key text, p_limit integer, p_window_seconds integer)`; none of the Fields tables.
`scripts/dev/production_drift_check.sql` tells you, per migration, what is really there. **It is one SELECT against the catalog and
cannot change anything.** Nothing in this task was run against production or any real database.

## How I checked the SQL itself
Not against production. I ran it only on throwaway PostgreSQL 16 clusters inside this sandbox (deleted afterwards):
1. On a stand-in for your production facts (those 4 tables + 2 functions + `auth.users`): section A all `false`/`partial`, section B all
   `absent (good)`, section C `ok` except the app rows listed below.
2. After applying every Fields migration (`20261012`..`20261023`) to that stand-in with `ON_ERROR_STOP`: all 15 applied cleanly (so they
   need nothing from production beyond the stand-in's objects), and section B reported all 63 Fields objects as present, which proves
   each name in the check is spelled the way the migration creates it.
3. After applying each non-Fields migration to the same base with errors tolerated: all 26 that ran cleanly and make changes came out
   `true`; the one exception, `20260626130000`, is a guarded no-op when the type `pickup_run_status` does not exist, and the check
   correctly reports it `false` with that type under "base objects missing".
4. A unit test (`__tests__/productionDriftCheck.test.ts`) asserts the file is one SELECT, starts with the read-only warning, covers every
   migration file in the range, and that every object name appears in the migration it is attributed to.

## Which migrations section A covers (41 files, after 20260523120000 and before the first Fields file 20261012000000)
| Area | Files |
|---|---|
| profiles | 20260525120000, 20260525130000, 20260528130000, 20260723120000, 20261002170000, 20261002180000, 20261005000100, 20261005000300 (also star_levels, verification_requests columns) |
| pickup runs / games | 20260526120000, 20260528120000, 20260609000000, 20260626130000, 20260708000000 (sessions map), 20260729000000, 20261002200000, 20261002220000, 20261004000000, 20261011000000 |
| credits / payments / prizes | 20260626000000, 20260626000000 body marker `1500`, 20261002160000, 20261002210000, 20260629000000, 20261008000000, 20261010000000 |
| tier system / stars / cards | 20260708000001, 20261002150000, 20261002190000, 20261002230000, 20261005000000, 20261005000400, 20261006100000, 20261003000000 |
| photos, Instagram, reports, discover, inbox | 20261002120000, 20261005000200, 20261005100000, 20261005120000, 20261005130000, 20261006000000 |
| chat | 20261007000000, 20261009000000 |
| votes | 20260729010000 |

Not checkable by a SELECT and therefore not covered: seed rows (`tier_pricing`, `star_bands`, `star_levels`), grants, comments, policy
bodies, and function bodies except the two markers named in the file. Objects that a later migration replaced (the `player_cards` view,
policy `own_verification`) are checked in their latest form only.

**Finding: the migrations do not create the base tables.** `profiles`, `pickup_runs`, `pickup_run_rsvps`, `tournaments`,
`pickup_credits`, `platform_payments`, `chat_*` and others are assumed to exist; replaying `supabase/migrations` on an empty database fails
at the first of them. Production got them some other way. Column "base objects missing" in the result shows which of those a given
migration needs and production lacks.

## Fields migrations and what they depend on (section C)
SQL-level, from the migration text (confirmed by applying them to the stand-in):

| Fields migration | Needs from older objects |
|---|---|
| 20261012000000 venues/schools | `is_admin_uid(uuid)` (and so `profiles.is_admin`) for its policies |
| 20261012000100 requests/events/slots | `is_admin_uid`, `auth.users`, `gen_random_uuid()` |
| 20261012000200 alerts/saved | `auth.users` |
| 20261013000000, 20261013000100, 20261014000000, 20261017000000, 20261019000000, 20261020000000, 20261022000000 | only other Fields objects (apply in filename order) |
| 20261015000000 plans, 20261016000000 season | `auth.users`, `gen_random_uuid()` |
| 20261018000000 suggestions | `is_admin_uid`, `auth.users`, `gen_random_uuid()` |
| 20261021000000 replies | `is_admin_uid`, `auth.users`, `gen_random_uuid()` |
| 20261023000000 games at fields | `public.pickup_runs` (raises an exception if missing) |

None of the Fields SQL touches `profiles` columns or `pickup_runs` columns other than adding `venue_key` and `venue_request_id`.

Code-level (the app and API routes that use the Fields data), the rows marked `APP:` in section C:
- **Rate limit** (`/api/fields/requests`, `/api/fields/report`, `/api/plans/checkout`): needs `api_rate_limit_check` **and** the table
  `api_rate_limit_buckets` it writes to, **and** EXECUTE for `service_role` (the routes call it with the service client). The function
  being present does not prove the other two; the check tests both. These routes fail open on an RPC error (they log and allow).
- **Admin gate and names** (`/api/fields/requests`, `/api/plans/checkout`, season fulfilment): `profiles.is_admin`, `first_name`,
  `last_name`, `username`.
- **Create a game at a field** (`/api/sessions/create` with `venue_key`): inserts `pickup_runs` columns `latitude`, `longitude`, `level`
  (type `session_level`), `spots_taken` and `open_tier_rank`, `fee_cents`, `run_type`, `format`, `tiered_pricing`, `service_region`,
  `is_current`, `auto_managed`, so **20260708000000 (sessions map) is a real dependency**. `time_tbd` (20261004000000) and `min_star`
  (20261011000000) are optional: the route retries without them when the column is missing. Status `in_progress` (20260626130000) is used
  by the game lifecycle.
- **Mobile**: `profiles.is_admin`, `approved`, `is_banned`; `pickup_run_rsvps`; `user_push_devices`.

**Things production might lack** (the check will say): `api_rate_limit_buckets`, the `service_role` grant on `api_rate_limit_check`,
`profiles.is_admin / first_name / last_name / username`, and the sessions-map columns on `pickup_runs`.

One more thing to eyeball (read-only, run separately): `is_admin_uid` in the repo is `stable` but **not** `security definer`, so inside an
RLS policy it reads `profiles` as the signed-in user and needs that user to be able to read their own `profiles` row. If production's copy
differs, admin-only Fields policies behave differently:
```sql
select prosecdef, pg_get_functiondef(oid) from pg_proc where proname = 'is_admin_uid' and pronamespace = 'public'::regnamespace;
```

## Signature check: how the Fields code calls the two functions
| Function | Production | Code | Match |
|---|---|---|---|
| `api_rate_limit_check` | `(p_bucket_key text, p_limit integer, p_window_seconds integer)` | `lib/server/persistentRateLimit.ts` calls `admin.rpc("api_rate_limit_check", { p_bucket_key: string, p_limit: number, p_window_seconds: number })` (two call sites); reads `{ allowed, retry_after_seconds }` | names and types match; the repo migration (`20260520140000`) returns `jsonb_build_object('allowed', ..., 'retry_after_seconds', ...)`, and the check confirms production's body contains `retry_after_seconds` |
| `is_admin_uid` | `(p_uid uuid)` | never called from TypeScript; only inside RLS policies as `public.is_admin_uid(auth.uid())` (uuid) | match |

No mismatch found. Production being one argument-name away from the repo would have shown up as a missing-function error in the app,
so the check also verifies argument count (3) rather than only the name.

## Steps for you
1. `git pull` on branch `claude/fields-step1`, then in the repo root: `pbcopy < scripts/dev/production_drift_check.sql`
2. Supabase dashboard → project **txsagoaqnohdnykweslc** (confirm the ref in the URL; it is production) → SQL Editor → New query →
   paste (Cmd-V) → Run. The first lines of the file say READ-ONLY; it is a single SELECT.
3. Read the result grid (about 70 rows; "Download CSV" works):
   - **Section A** column `applied?`: `true` = already in production (applied by hand); `false` = not there; `partial` = half there,
     the `missing` column says which part. `base objects missing` non-empty = that migration cannot run until the older object exists.
   - **Section B** must read `absent (good)` on all 15 rows. `PRESENT: n` means part of the Fields work is already in production; stop
     and send me that row.
   - **Section C** `ok` or `MISSING: n` with the list. Each `MISSING` is something to resolve before the Fields migrations or the app.
4. Paste the three sections back to me; I will turn them into the ordered list of migrations to apply (and which to skip).
