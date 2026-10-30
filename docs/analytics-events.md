# Analytics events

First-party only. Events live in `public.analytics_events` (migration `20261026000000_analytics_events.sql`), readable by admins only, deleted with the account. No third-party SDKs, no device or Wi-Fi fingerprinting, no cross-app tracking, no contacts, no precise location.

## How an event gets there

| Source | Written by | Trusted for | Gate |
|---|---|---|---|
| `server` | Database triggers (`20261026000100_analytics_triggers.sql`) and API routes, using the service role | The truth: RSVPs, waitlist, attendance, votes, pushes sent, requests | Always on once the migration is applied |
| `client` | The app, in batches to `POST /api/analytics/events` | Views and taps only | Flag `analytics_client` (default OFF) and the player's "Share usage data" switch |

Why triggers for RSVP and attendance: the RSVP table is written from many routes (join, cancel, waitlist promotion, admin changes, payment webhooks, cron). A trigger sees every change once, in the same transaction, and cannot be skipped by a new route. Every trigger swallows its own errors, so analytics can never block a join.

Idempotency: every event has an `event_key` with a unique constraint. A retried request stores one row. Client keys are `c:<user>:<client event id>`; server keys are built from facts that repeat (a row id, a push id plus user).

## Taxonomy

`region` is the game's service region (CT, NY, NJ, MD) when the event is about a game, otherwise empty. `run_id` is a generated column over `properties.run_id`.

| Event | Source | When | Properties |
|---|---|---|---|
| `account_approved` | server (trigger on `profiles.approved`) | A player is approved | none |
| `run_list_viewed` | client | The games list or the runs tab is shown | `list_kind` |
| `run_viewed` | client | A game page is opened | `run_id` |
| `recommendation_shown` | client | A "Best games for you" card is shown (once per game per app launch, max 10) | `run_id`, `rank`, `list_kind`, `reasons` (up to two reason codes) |
| `recommendation_tapped` | client | That card is tapped | same |
| `rsvp_started` | client (tap on Join) and server (payment pending) | A player starts to join | `run_id`, `trigger` (`tap`, `payment_pending`), `status` |
| `rsvp_completed` | server | A spot is confirmed | `run_id`, `status` |
| `rsvp_cancelled` | server | A player cancels or the row is deleted | `run_id`, `status`, `hours` (before kickoff) |
| `waitlisted` | server | A player joins the waitlist | `run_id`, `status` |
| `waitlist_promoted` | server | A waitlist spot is offered | `run_id`, `status` |
| `checked_in` | reserved | **Not emitted.** There is no check-in feature in the app. The name is allowed so it can be added without a migration | |
| `attended` | server | Marked present by an admin (trigger on `pickup_run_attendance`) or counted from a submitted result | `run_id`, `trigger` (`admin_mark`, `result`) |
| `no_show` | server | Marked absent by an admin | `run_id`, `trigger` |
| `postgame_vote_completed` | server | A player finishes a post-game vote or rating | `run_id`, `vote_type` (`peer_vote`, `potd`, `host_rating`, `peer_rating`) |
| `play_again_tapped` | client | "Play with this group again" is tapped | `run_id` |
| `play_again_created` | server | The next game is created from it | `run_id`, `new_run_id`, `role` |
| `push_sent` | server | A push was handed to Expo for a player | `push_id`, `kind`, `category` |
| `push_suppressed` | reserved | Not emitted yet. Suppression counts are in the push send result | |
| `push_opened` | client | A notification is tapped | `push_id`, `kind` |
| `push_pref_changed` | server | A notification setting is saved | `category`, `enabled` |
| `alert_subscribed` | client | A Fields alert switch is changed | `alert_type`, `enabled` |
| `field_viewed` | client | A field page is opened | `venue_key` |
| `field_request_sent` | server | A field request is submitted | `venue_key`, `hours`, `count` |

## Property rules (enforced twice)

Allowed keys: `run_id venue_key kind category reason reasons position count from_screen list_kind push_id alert_type enabled role status result step trigger rank minutes_before days hours price_cents capacity spots_left new_run_id vote_type`.
Allowed values: booleans, numbers under 1,000,000,000, or strings matching `^[A-Za-z0-9_.:,|-]{1,64}$` (no spaces and no `@`, so no names, emails, phone numbers or free text). At most 12 keys.
The same lists are in `lib/analytics/events.ts` (drops what is not allowed) and in the database `CHECK` (`analytics_props_ok`, refuses it). A test compares the two lists.

The app may send only the client events above. The route drops any other name, so a modified app cannot write an RSVP or an attendance record.

## Privacy and deletion

- Read access: admins only (RLS `analytics_events_admin_read`). Writes: service role, and SECURITY DEFINER triggers.
- Account deletion: `cleanupUserData` deletes the player's events. The foreign key is `ON DELETE SET NULL` as a safety net: if an account is removed some other way the events stay but stop pointing at anyone, so team totals do not change and nothing identifies the person.
- Opt out: Settings, "Share usage data" (stored as `profiles.analytics_opt_out`). Off means the route stores no client events and the app empties its local queue. Game activity is still recorded because the game needs it to run.
- Retention: 24 months. The weekly cron `/api/cron/analytics-prune` calls `analytics_prune(730)`.

## Metrics

`20261026000200_analytics_metrics.sql` defines the views: `analytics_first_game_funnel`, `analytics_second_game_30d`, `analytics_retention_cohorts`, `analytics_run_health` (and `_by_region`), `analytics_notification_effectiveness`, `analytics_recommendation_effectiveness`, `analytics_play_again_rate`. Only the service role can read them. The admin screen reads `GET /api/admin/analytics/retention`.

For a baseline from the tables production already has, run `scripts/dev/retention_metrics_readonly.sql` (one SELECT, changes nothing).

Limits to remember: events begin when the migration is applied, so the views are empty at first. `approved_at` for existing players is an upper bound (see the migration). App-side steps (looked, opened, taps, opens) exist only for players who share usage data and only while the flag is on, so those counts are lower bounds.

## Adding an event

1. Add the name to `EVENT_NAMES` in `lib/analytics/events.ts` and to the `CHECK` in a new migration.
2. Add any new property key to both allowlists.
3. Emit it from the server (preferred) or add it to `CLIENT_EVENT_NAMES`.
4. Add a row to the table above.

## App Store privacy label

See `docs/app-store-privacy-label.md`.
