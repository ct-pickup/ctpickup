-- Query helpers for admin run lists, push fan-out, RSVP aggregations, tournaments, and invite eligibility.

CREATE INDEX IF NOT EXISTS pickup_runs_admin_list_idx
  ON public.pickup_runs (service_region, status, created_at DESC);

CREATE INDEX IF NOT EXISTS user_push_devices_active_idx
  ON public.user_push_devices (user_id, push_notifications_enabled);

CREATE INDEX IF NOT EXISTS pickup_run_rsvps_run_status_idx
  ON public.pickup_run_rsvps (run_id, status);

CREATE INDEX IF NOT EXISTS tournaments_region_status_idx
  ON public.tournaments (service_region, status, created_at DESC);

CREATE INDEX IF NOT EXISTS profiles_invite_eligible_idx
  ON public.profiles (tier_rank, approved, is_banned)
  WHERE approved = true AND is_banned = false;
