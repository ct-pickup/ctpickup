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

Use in **Supabase → Auth → Email Templates** for the **login code / OTP** email.

**Subject line**

`Your login code`

**HTML body**

```html
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:560px;">
            <tr>
              <td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; line-height: 24px; color: #111111;">
                <div style="margin:0;">Your login code</div>
                <br />
                <div style="margin:0;">Enter this code in the app to continue:</div>
                <br />
                <div style="font-size: 28px; font-weight: 600; letter-spacing: 4px; line-height: 36px; margin: 0;">
                  {{ .Token }}
                </div>
                <br />
                <div style="margin:0;">This code expires shortly.</div>
                <br />
                <div style="margin:0;">– CT Pickup</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### Plain text (same message)

```
Your login code

Enter this code in the app to continue:

{{ .Token }}

This code expires shortly.

– CT Pickup
```

## Operational checks

- Send a real message to Gmail + one other provider; check **Spam** folder for the first sends.
- Keep **bounce** and **complaint** rates low: don’t send auth mail to purchased lists (N/A for OTP).
- Use a **dedicated** transactional address (`login@`) separate from marketing, if you add newsletters later.
