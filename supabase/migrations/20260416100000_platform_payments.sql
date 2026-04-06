-- Unified Stripe payment visibility for staff (pickups, tournaments, and future product types).

create table if not exists public.platform_payments (
  id uuid primary key default gen_random_uuid(),
  product_type text not null
    check (product_type in ('pickup', 'tournament', 'sports', 'guidance', 'training')),
  product_entity_id text not null,
  user_id uuid not null,
  title text not null,
  summary text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  currency text not null default 'usd',
  lifecycle_status text not null
    check (lifecycle_status in (
      'checkout_started',
      'payment_received',
      'payment_failed',
      'refunded',
      'checkout_expired'
    )),
  fulfillment_status text not null
    check (fulfillment_status in ('pending', 'succeeded', 'failed', 'not_applicable'))
    default 'pending',
  fulfillment_message text,
  stripe_payment_received_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_payments_user_created_idx
  on public.platform_payments (user_id, created_at desc);

create index if not exists platform_payments_type_lifecycle_idx
  on public.platform_payments (product_type, lifecycle_status);

create index if not exists platform_payments_created_idx
  on public.platform_payments (created_at desc);

create index if not exists platform_payments_stripe_pi_idx
  on public.platform_payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

comment on table public.platform_payments is
  'One row per checkout session (and lifecycle) for Stripe-backed products; staff-facing observability.';

-- Webhook processing audit (plain-English summaries for staff; not full Stripe payloads).
create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  platform_payment_id uuid references public.platform_payments (id) on delete set null,
  stripe_event_id text not null unique,
  event_type text not null,
  outcome text not null
    check (outcome in ('processed_ok', 'processed_failed', 'ignored', 'received_only')),
  staff_summary text not null,
  needs_retry boolean not null default false,
  error_detail text,
  created_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_payment_idx
  on public.stripe_webhook_events (platform_payment_id, created_at desc);

create index if not exists stripe_webhook_events_created_idx
  on public.stripe_webhook_events (created_at desc);

comment on table public.stripe_webhook_events is
  'Stripe webhook deliveries and how the app responded; for staff troubleshooting.';

alter table public.platform_payments enable row level security;
alter table public.stripe_webhook_events enable row level security;
