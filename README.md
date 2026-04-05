This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Connect the repo to [Vercel](https://vercel.com/new) and deploy as a Next.js app. Use **Production deployment** below for env vars and external services.

## Production deployment

Mirror [`.env.example`](./.env.example) in the Vercel project **Settings → Environment Variables** (Production, and Preview if needed).

### Required Vercel environment variables

| Variable | Notes |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** — never expose to the client |
| `NEXT_PUBLIC_SITE_URL` | Canonical public origin, e.g. `https://your-domain.com` (no trailing slash). Used for Stripe return URLs and server-side fetches. |
| `STRIPE_SECRET_KEY` | Live secret for tournament captain checkout and pickup field fees |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `POST /api/stripe/webhook` (from Stripe Dashboard → Webhooks) |
| `CRON_SECRET` | Shared secret: Vercel Cron calls `GET /api/cron/pickup-auto` with `Authorization: Bearer <CRON_SECRET>`. The route returns 500 if this is unset. |

### Strongly recommended

| Variable | Notes |
|----------|--------|
| `OPENAI_API_KEY` | Tournament AI intake (`/api/tournament/intake`) and Help assistant (`/api/help/chat`) |
| `STRIPE_API_VERSION` | Optional; must match your Stripe account API version if you set it |

### Optional (Twilio SMS, if you use it)

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — see comments in `.env.example`.

`VERCEL_URL` is set automatically on Vercel and is used as a fallback when `NEXT_PUBLIC_SITE_URL` is missing.

### Supabase migrations

Apply all SQL in `supabase/migrations/` to your **production** Supabase project (via Supabase SQL editor, CLI, or CI) before relying on features that depend on those tables (profiles, pickup, tournaments, waivers, guidance, esports, etc.).

### Stripe webhook

In the Stripe Dashboard, add a webhook endpoint pointing at:

`https://<your-production-domain>/api/stripe/webhook`

Subscribe to the event types your handler uses (see `app/api/stripe/webhook/route.ts`). Use the **live** signing secret in production env if the code expects it.

### Admin access

Users who should use `/admin/*` must have `profiles.is_admin = true` in Supabase for their `auth.users` id.

### Cron

`vercel.json` schedules `/api/cron/pickup-auto`. Ensure `CRON_SECRET` is set in Vercel and matches the Bearer token Vercel sends (configure in the cron job / project settings per Vercel docs for your plan).
