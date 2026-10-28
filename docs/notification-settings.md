# Notification settings (categories and quiet hours)

Behind the `notification_settings` flag (off by default). The settings live on `profiles` (migration `20261025000200_push_preferences.sql`) and are
enforced on the server in `lib/push/sendExpoPush.ts`, so every send path respects them, including old app builds.

| Category | Switch | Pushes in it |
|---|---|---|
| Games | `push_cat_games` | new games, invites, confirmations, cancellations, follows, followed hosts, tournaments |
| Reminders and waitlist | `push_cat_reminders` | a waitlist spot opening, "spot expiring", rate-your-game reminders, tournament starts soon |
| Results and awards | `push_cat_results` | results, awards, voting, standings |
| Chat | `push_cat_chat` | chat messages, announcements |
| Field alerts | `push_cat_fields` | new games near me, open times, changes at saved fields, field request updates |
| News and offers | `marketing_push_enabled` (existing) | staff broadcasts and promotions (opt-in) |

Anything else (account, payment, admin pushes) is not controllable. It is still subject to quiet hours.

**Quiet hours.** `quiet_hours_enabled`, `quiet_hours_start`, `quiet_hours_end` (minutes after midnight) and `quiet_hours_tz` (the device zone when the
player saved; null means US Eastern). A window that starts after it ends crosses midnight. A push that falls in quiet hours is skipped, not delayed.

**Urgent pushes** skip quiet hours but never a switched-off category: a waitlist spot for a game that starts within 2 hours (or began in the last hour),
and a cancellation for a game played today (US Eastern date). They are marked at the send site with `{ urgent: true }`.

**Rule-based alerts** (Fields alerts, followed hosts) also go through `push_ledger`: at most one push per type per player per 6 hours, and never the same
event twice (`claim_push_slots`). Quiet hours and categories are applied after that, so a skipped alert still uses the player's slot.

Adding a new push kind: give it a `kind` in `data` and add it to `KIND_CATEGORY` in `lib/push/pushPolicy.ts`; an unlisted kind is "other".
