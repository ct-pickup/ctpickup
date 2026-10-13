-- Fields: guards on venue_requests. Additive. Depends on 20261012000100_fields_requests_events_slots.sql.
--
--   * No duplicate: a player can have only one open request for the same venue, date and start time.
--     "Open" = new, waiting_on_school or approved. A declined or cancelled request does not block a new one.
--   * Rate limit: a player can create at most 10 requests in any 24 hours. This is a backstop in the database
--     for direct client inserts (the API route also rate limits per hour).
-- Both fire for every insert path, including the service role.

begin;

create unique index if not exists venue_requests_one_open_per_slot
  on public.venue_requests (user_id, venue_key, requested_date, start_time)
  where status in ('new', 'waiting_on_school', 'approved');

create or replace function public.venue_requests_rate_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  recent integer;
begin
  select count(*) into recent
  from public.venue_requests r
  where r.user_id = new.user_id
    and r.created_at > now() - interval '24 hours';
  if recent >= 10 then
    raise exception 'venue_request_rate_limit' using errcode = 'P0001', hint = 'Too many requests in 24 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists venue_requests_rate_limit on public.venue_requests;
create trigger venue_requests_rate_limit
  before insert on public.venue_requests
  for each row execute function public.venue_requests_rate_limit();

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop trigger if exists venue_requests_rate_limit on public.venue_requests;
-- drop function if exists public.venue_requests_rate_limit();
-- drop index if exists public.venue_requests_one_open_per_slot;
-- commit;
-- ============================================================
