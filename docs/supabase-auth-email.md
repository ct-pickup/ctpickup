# Supabase Auth email (CT Pickup)

This app signs users in with **email OTP**: `signInWithOtp` + `verifyOtp` with an **8-digit code**. Templates and SMTP live in the **Supabase Dashboard**, not in this repo—keep them aligned with the UI copy in `app/login` and `app/signup`.

## Sender alignment (Resend + Supabase)

| Setting | Recommended |
|--------|-------------|
| **From name** | `CT Pickup` (title case; avoid ALL CAPS) |
| **From address** | `login@ctpickup.net` (or your verified Resend domain sender) |
| **SMTP / provider** | Resend SMTP credentials in **Supabase → Project Settings → Auth → SMTP Settings** |
| **Site URL** | Match production: `https://ctpickup.net` (and Auth redirect URLs) |

Verify in **Resend**: domain DNS (SPF, DKIM, optionally DMARC) for `ctpickup.net`. Poor DNS alignment is a common deliverability failure—not “spam words.”

## Auth: 8-digit OTP

In **Supabase → Authentication → Providers → Email**, set the **OTP length to 8** (or the value your project uses) so it matches app copy and validation (`app/login/page.tsx`, `app/signup/page.tsx`).

## Reduce spam risk (content & structure)

**Do**

- Use **short, sentence-case subjects** (e.g. `Your CT Pickup sign-in code`).
- Keep the body **transactional**: one clear purpose, code prominent, expiry line, ignore-if-not-you.
- Prefer **simple HTML**: single column, system fonts or one web-safe font, no heavy images in auth mail.
- Include **plain-text** part mirroring the HTML (Supabase sends multipart when you provide both).
- **One** primary action: the code itself; avoid piling links (social, marketing, trackers).

**Avoid**

- ALL CAPS subjects, multiple `!!!`, or “FREE / ACT NOW” tone.
- Many links, URL shorteners, or large promotional banners.
- Mismatched **From** domain vs **SPF/DKIM** signing domain.

## Code-first templates (optional)

If sign-in is **code-only** in the product, edit Auth email templates so the **8-digit code** is primary. You may remove or shorten magic-link copy if you do not rely on `{{ .ConfirmationURL }}`. If you keep a link for accessibility, one line is enough—avoid “Click here to log in!!!”.

Variables depend on Supabase version; common ones include `{{ .Token }}`, `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`. Confirm in **Auth → Email Templates** preview.

### Suggested subject lines

- Sign-in / magic-link style (OTP): `Your CT Pickup sign-in code`
- Sign-up confirm (if used): `Confirm your CT Pickup account`

### Minimal HTML body (OTP emphasis)

Use in the template editor (adjust variables to match your Supabase template names):

```html
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#111;background:#fafafa;">
  <p style="margin:0 0 12px;">Hi,</p>
  <p style="margin:0 0 16px;">Use this code to sign in to <strong>CT Pickup</strong>:</p>
  <p style="margin:0 0 20px;font-size:22px;letter-spacing:0.2em;font-weight:600;">{{ .Token }}</p>
  <p style="margin:0 0 8px;color:#444;font-size:14px;">This code expires soon. If you didn’t request it, you can ignore this email.</p>
  <p style="margin:16px 0 0;color:#666;font-size:13px;">— CT Pickup</p>
</body>
</html>
```

### Plain text (same message)

```
Hi,

Use this code to sign in to CT Pickup:

{{ .Token }}

This code expires soon. If you didn't request it, you can ignore this email.

— CT Pickup
```

## Operational checks

- Send a real message to Gmail + one other provider; check **Spam** folder for the first sends.
- Keep **bounce** and **complaint** rates low: don’t send auth mail to purchased lists (N/A for OTP).
- Use a **dedicated** transactional address (`login@`) separate from marketing, if you add newsletters later.
