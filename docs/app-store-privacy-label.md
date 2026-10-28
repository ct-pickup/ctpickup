# App Store privacy label: changes needed for the usage data work

Do these in App Store Connect, App Privacy, before the build that turns on `analytics_client` ships. Nothing here is done for you.

Answer as the facts stand today: first-party analytics, linked to the account, not used for tracking, no third-party analytics SDK.

## Data types to add or confirm

| Data type | Collected | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|---|
| Usage Data > Product Interaction | Yes | Yes | No | Analytics, App Functionality |
| Identifiers > User ID | Yes (confirm; it is likely already declared for the account) | Yes | No | App Functionality, Analytics |
| Diagnostics | No change (only if Sentry is already declared) | | | |

Product Interaction covers which screens are opened and which suggested games are tapped, plus game activity (joining, cancelling, attendance).

## Data types that stay "not collected" for this work

Contacts, Precise Location, Coarse Location (the events carry a game's service region such as CT, not the player's location), Search History, Browsing History, Advertising Data, Device ID (no IDFA, no vendor ID in events), Other Data Types.

## Tracking

Leave "Does this app track you" as No. Events stay inside our own database, are not combined with other companies' data and are not shared with data brokers or advertisers. Because of that no App Tracking Transparency prompt is needed.

## Also check

- The Privacy Policy URL still points at `/privacy` (updated with a "Usage data" section).
- If Sentry or Expo push are declared under Diagnostics or Identifiers, nothing changes for them.
- `NSUserTrackingUsageDescription` must stay absent from the app config.
