/**
 * Non-secret configuration health for the staff settings screen.
 */

export type EnvFlag = { key: string; ok: boolean; hint?: string };

export function collectPublicEnvHealth(): EnvFlag[] {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return [
    {
      key: "NEXT_PUBLIC_SUPABASE_URL",
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    },
    {
      key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
    },
    {
      key: "NEXT_PUBLIC_SITE_URL",
      ok: !!siteUrl,
      hint: siteUrl ? undefined : "Needed for Stripe return URLs and Twilio signature checks.",
    },
  ];
}

export function collectServerEnvHealth(): EnvFlag[] {
  return [
    { key: "SUPABASE_SERVICE_ROLE_KEY", ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() },
    { key: "STRIPE_SECRET_KEY", ok: !!process.env.STRIPE_SECRET_KEY?.trim() },
    { key: "STRIPE_WEBHOOK_SECRET", ok: !!process.env.STRIPE_WEBHOOK_SECRET?.trim() },
    {
      key: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      ok: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim(),
      hint: "Optional for hosted Checkout only.",
    },
    { key: "OPENAI_API_KEY", ok: !!process.env.OPENAI_API_KEY?.trim(), hint: "Tournament intake & help assistant." },
    {
      key: "TWILIO_ACCOUNT_SID",
      ok: !!process.env.TWILIO_ACCOUNT_SID?.trim(),
      hint: "Optional — SMS outreach for pickup.",
    },
    {
      key: "CRON_SECRET",
      ok: !!process.env.CRON_SECRET?.trim(),
      hint: "Vercel Cron bearer for scheduled pickup checkpoints.",
    },
  ];
}
