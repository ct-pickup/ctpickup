# CT Pickup — App Store Review Notes

Use this document for **App Store Connect → App Review Information → Notes** and for internal QA before submission.

## Demo account

| Field | Value |
| --- | --- |
| **Email** | `appreview@ctpickup.net` |
| **Password** | `CtPickup_AppReview2026!` |

**Sign-in on the iOS app:** Open the app → enter the email above → tap to send an **8-digit code** → enter the code from the inbox for `appreview@ctpickup.net` (codes are monitored for review). The password is for Supabase Dashboard / backup access; the mobile app uses email OTP, not a password field.

This account is **pre-approved** in production with **player** (non-admin) permissions, **tier 1A** (`tier_rank = 1`), and **nearest venue** `New Haven SoccerRoof` (Connecticut hub).

## Manual approval gate

New users require **staff approval** before messaging, select-run invites, and some actions. The demo account above is **already approved** and does not need to wait.

**Optional — Review Mode (client bypass):** If you sign in with any account that is still pending approval, you can enable a hidden bypass for UI testing:

1. Go to **Profile** (Account tab).
2. Tap **About this app** **5 times**.
3. Enter secret code: `CTPICKUP-REVIEW`
4. A lime banner **“App Review Mode Active”** appears; client-side approval checks are bypassed. Tap the banner to turn off.

Review Mode does not change server data; use the pre-approved demo account for full end-to-end flows (RSVP, payments, chat).

## Step-by-step walkthrough

### 1. Sign in

1. Launch **CT Pickup**.
2. Enter `appreview@ctpickup.net`.
3. Request the sign-in code and enter the **8-digit code** from email.
4. Complete the **liability waiver** if prompted (one-time).
5. Complete **profile** fields if prompted (name, ZIP, position).

### 2. View a pickup run

1. Open the **Pickup** tab.
2. Choose **Connecticut (CT)** if asked for a state.
3. The featured run card shows venue, time, and status (Public or Select).
4. Optional: open **Run history** from Profile for past runs.

### 3. RSVP

1. On the featured run, when the run is open, tap **I'm in** (or confirm a waitlist spot if offered).
2. If a fee applies, complete checkout with the **Stripe test card** below.
3. Pull to refresh to see **confirmed** status.

### 4. Chat

1. Open the **Messages** tab.
2. Open **Announcements** or **Team chat** under Channels.
3. After RSVP, **run banter** may appear for that pickup (under run-related rooms when configured).

### 5. Tournaments

1. Open the **Tournaments** tab → select **CT** if needed.
2. Tap the tournament card → **Field tournament** detail (signup, captain claim, bracket).
3. From Home, the tournament promo card also links to the same flow.

## Stripe payments

Pickup fees pay for **physical, real-world soccer sessions** (App Store guideline **3.1.3(e)** — goods and services used outside the app).

**Test card (Stripe test mode):**

- Number: `4242 4242 4242 4242`
- Expiry: any future date (e.g. `12/34`)
- CVC: any 3 digits (e.g. `123`)
- ZIP: any valid US ZIP

## Push notifications during review

1. On the demo device, sign in as `appreview@ctpickup.net`.
2. On **Profile**, enable **Push notifications** and allow iOS permission when asked.
3. A **staff admin** (separate account) opens the app → **Admin** tab → **Broadcast Message** (or uses the web admin at `https://ctpickup.net`).
4. Send a test broadcast to **All approved** or filter by **CT** / **tier 1A** so the demo user receives it.
5. Background the app briefly; the notification should appear on the device.

Push requires a **TestFlight / App Store build** (not Expo Go).

## Contact

Questions during review: **pickupct@gmail.com**
