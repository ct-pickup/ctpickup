# CT Pickup — App Store Review Notes

## Demo Account

| Field | Value |
|---|---|
| Email | pickupct@gmail.com |
| Password | CtPickup_AppReview2026! |

**How to sign in:**
1. Launch CT Pickup
2. Enter pickupct@gmail.com
3. Tap "Already have an account?"
4. Enter the password above
5. Tap Sign In

This account is fully pre-approved with tier 1A status and nearest venue set to New Haven SoccerRoof (Connecticut). No waiting for staff approval.

---

## Manual Approval Gate

CT Pickup is an invite-based soccer community. New user accounts require staff approval before accessing select runs, messaging, and certain features. This is intentional — it ensures community quality and safety.

The demo account (pickupct@gmail.com) is pre-approved and has full access to all player-facing features immediately upon login.

**If you want to test the signup flow with a fresh account:**
1. Create a new account with any email
2. Go to Profile tab → scroll to bottom → tap "About this app" 5 times
3. Enter code: CTPICKUP-REVIEW
4. A lime "App Review Mode Active" banner appears
5. Client-side approval checks are bypassed for UI testing
6. Tap the banner to disable Review Mode

Note: Review Mode only bypasses client-side UI gates. For full end-to-end flows including payments and chat, use the pre-approved demo account.

---

## Full Walkthrough

### Step 1 — Sign In
1. Launch CT Pickup
2. Enter pickupct@gmail.com → tap "Already have an account?" → enter password
3. If prompted, complete the liability waiver (one-time, scroll and accept)
4. If prompted, complete profile (name, ZIP code, playing position — Instagram is optional)

### Step 2 — Pickup Runs
1. Tap the Pickup tab (soccer ball icon)
2. Select Connecticut (CT) from the state picker
3. The featured run card appears showing venue, date, fee, and spots remaining
4. During Planning status: vote on available time slots by tapping them
5. During Active status: tap "I'm In" to RSVP
6. If a fee applies, Stripe checkout opens — use test card below
7. Pull down to refresh and see confirmed status

### Step 3 — Payments
All fees are for physical real-world soccer sessions at actual venues. This falls under App Store guideline 3.1.3(e) — goods and services consumed outside the app. No digital content or in-app features are unlocked by payment.

Before checkout opens, the app displays: "Payment is for a physical soccer session at [venue name]. This is not a digital purchase."

**Stripe test card:**
- Card number: 4242 4242 4242 4242
- Expiry: 12/34
- CVC: 123
- ZIP: 06511

### Step 4 — Messages / Chat
1. Tap the Messages tab
2. Open Announcements for staff broadcasts
3. Open Team chat for community discussion
4. After confirming an RSVP, a run-specific banter room may appear

### Step 5 — Tournaments
1. Tap the Tournaments tab
2. Select a state (CT, NY, NJ, or MD)
3. View the active tournament card showing teams, bracket status, and registration
4. Tap View bracket & standings for full tournament details

### Step 6 — Profile & Account
1. Tap Profile tab
2. View reliability score, referral code, credits, preferences
3. Push notifications toggle: operational alerts (run invites, RSVP confirmations)
4. Marketing updates toggle: staff broadcasts and announcements (separate opt-in)
5. Max drive time slider: controls proximity for run invites (35–90 min)
6. Account deletion available at bottom of Profile → Danger Zone → Delete Account

---

## Push Notifications

Push notifications are used exclusively for operational alerts:
- Run invites (wave-based, tier-matched)
- RSVP confirmations
- Time slot finalized for a run
- Waitlist spot offered
- Monthly award notifications

Marketing/promotional notifications (broadcasts, announcements) require a separate explicit opt-in toggle ("Marketing updates") in Profile settings. Users can opt out of either type independently.

Push is not required for the app to function — all core features work without enabling notifications.

**To test push during review:**
1. Sign in as pickupct@gmail.com on a physical device
2. Enable both "Push notifications" and "Marketing updates" in Profile
3. Allow iOS permission when prompted
4. A staff admin can send a test broadcast via Admin tab → Broadcast Message → All approved

Push requires a TestFlight or App Store build (not Expo Go).

---

## Payments — Detailed Explanation for App Review

CT Pickup charges fees for two types of real-world physical services:

1. **Pickup run fees ($6–$10):** Players pay to reserve a spot at an organized outdoor soccer session at a physical venue (e.g. New Haven SoccerRoof, Sofive Brooklyn). The session takes place in person, outside the app. Payment is collected via Stripe before the event. This is squarely covered by App Store guideline 3.1.3(e) — "goods and services that will be consumed outside the app."

2. **Field tournament entry fees:** Team captains pay to enter their team in an in-person outdoor soccer tournament. Teams show up on the day, play on a real field, and compete for a physical trophy/prize. Again, entirely consumed outside the app.

**Nothing digital is purchased.** No in-app content, no feature unlocks, no premium tiers, no subscriptions. The app is free to download and free to use. Fees only apply when a player chooses to join a specific real-world event.

**Referral credits and monthly reward credits** are promotional discounts applied to pickup fees. They have no cash value, cannot be transferred, and only reduce the cost of attending a physical soccer session. They are not sold, not purchased, and not redeemable for anything digital.

---

## User-Generated Content & Safety

CT Pickup includes chat rooms for run participants and team members. We have implemented all required UGC safeguards:

- **Content filter:** Server-side profanity filter on all chat messages before storage
- **Report mechanism:** Every message and profile has a Report button; reports go to admin queue
- **Block:** Users can block other users from Profile → block, removing them from shared chat views
- **Moderation SLA:** Staff reviews reported content within 24–48 hours
- **Contact:** pickupct@gmail.com for urgent moderation issues

---

## Age Rating

CT Pickup is rated 13+. During signup, users must check a box confirming "I confirm I am 13 years of age or older" before completing profile creation. The app does not target children and is not in the Kids Category.

---

## Login & Authentication

- **Sign up:** Email → 8-digit OTP code to verify email → set password → complete profile
- **Log in:** Email + password, or Face ID/Touch ID after first login
- **No third-party social login** (no Facebook, Google, etc.) — email/password only, so Sign in with Apple is not required per guideline 4.8
- Sign in with Apple will be added before any third-party social login is introduced

---

## Privacy

- Privacy policy is accessible in-app at Profile → Privacy Policy and at https://ctpickup.net/privacy
- All third-party processors are disclosed: Stripe, Supabase, Sentry, OpenAI (Help assistant), Expo (push), Google Maps (server-side drive time)
- The Help assistant uses OpenAI — this is disclosed in-app with an "AI-Powered" badge and disclaimer
- No GPS or device location is accessed — proximity matching uses ZIP code entered by the user
- No App Tracking Transparency required — no cross-app tracking or advertising IDs used
- Account deletion is available in-app at Profile → scroll to bottom → Delete Account

---

## Contact

Questions during review: pickupct@gmail.com
Website: https://ctpickup.net
Support URL: https://ctpickup.net
