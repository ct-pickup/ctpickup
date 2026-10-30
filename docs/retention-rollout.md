# Retention and analytics: rollout

Nothing here has been run against any database. Apply to DEV (`plratvhywezrtedwipsm`) first, check, then production.

## Order

1. DEV must already have the stubs: `scripts/dev/fields_stub_tables.sql`, then `scripts/dev/dev_pickup_runs_stub.sql`.
2. Apply, in this order (all additive and idempotent, each has a verify query and a rollback at the top):
   - `20261025000000_push_ledger.sql`
   - `20261025000100_retention_flags.sql` (four flags, all OFF)
   - `20261025000200_push_preferences.sql`
   - `20261026000000_analytics_events.sql`
   - `20261026000100_analytics_triggers.sql`
   - `20261026000200_analytics_metrics.sql`
3. Deploy the server. With every new flag OFF, players see no change. Two things are live without a flag: the server events (a trigger per RSVP change, `push_sent` per push) and the new privacy text.
4. Baseline numbers from production before anything else: `scripts/dev/retention_metrics_readonly.sql` (one SELECT, changes nothing).

## Flags (Admin, Feature flags)

| Flag | Turns on |
|---|---|
| `notification_settings` | Notification types and quiet hours in Settings, and `/api/mobile/push-settings` |
| `analytics_client` | App usage events, `/api/analytics/events`, the "Share usage data" switch |
| `play_again` | "Play with this group again" on the recap, repeat in Host a Session, `/api/sessions/play-again` |
| `host_follow_alerts` | Push to followers when a host posts a game, and the follow hint on profiles |
| `fields` (existing) | Also gates the Fields alert pushes |

Turn each on for the allowlist (yourself) first. Category switches and quiet hours are enforced on the server for every push once the migration is applied, even with `notification_settings` OFF: the columns default to everything on and quiet hours off, so behaviour does not change until a player edits them.

## Checks on DEV

- Approve a test profile: one `account_approved` row and `profiles.approved_at` set.
- Join, cancel and waitlist on a test game: `rsvp_completed`, `rsvp_cancelled`, `waitlisted` rows, region filled when `pickup_runs.service_region` exists.
- `select * from analytics_first_game_funnel;` returns rows without error.
- With `analytics_client` on for you: open a game, then check `select name, count(*) from analytics_events where source = 'client' group by 1;`.
- A finished test game: the recap shows the card for the host (button) and for a player (ask the host).

## Cron

`vercel.json` gains `/api/cron/analytics-prune` (weekly, Sunday 04:17 UTC), which deletes usage events older than 24 months. It does nothing until the analytics migration is applied.
