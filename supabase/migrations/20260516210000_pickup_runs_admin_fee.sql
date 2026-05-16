-- Admin earnings for a pickup run (total dollars * 100), stored separately from per-player fee_cents.
ALTER TABLE public.pickup_runs
ADD COLUMN IF NOT EXISTS admin_fee_cents integer NOT NULL DEFAULT 0;
