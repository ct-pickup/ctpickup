-- Push ledger: one row per push a rule-based alert sent, so alerts can be rate limited and de-duplicated.
-- Additive and idempotent. No CASCADE. Needs nothing beyond auth.users.
--
--   bucket      what kind of push this was: 'slot_opens', 'new_games', 'changes_cancellations', 'host_new_run', ...
--   dedupe_key  what the push was about (a run id, a venue and day, ...). The same key is never sent to the same user twice.
--   sent_at     when it was sent. claim_push_slots() refuses a user who already got this bucket inside the window.
--
-- claim_push_slots(users, bucket, dedupe_key, window_hours) returns the user ids that may be pushed now and records them
-- in the same statement, so two requests cannot both pass. The service role only; players cannot read or write the ledger.
--
-- Verify after running:
--   select to_regclass('public.push_ledger'), to_regprocedure('public.claim_push_slots(uuid[], text, text, integer)');
--   select public.claim_push_slots(array[]::uuid[], 'verify', 'verify', 6);    -- returns no rows
-- Rollback (manual):
--   begin;
--   drop function if exists public.claim_push_slots(uuid[], text, text, integer);
--   drop table if exists public.push_ledger;
--   commit;
begin;

create table if not exists public.push_ledger (
  id         bigserial primary key,
  user_id    uuid references auth.users (id) on delete set null,
  bucket     text not null check (bucket ~ '^[a-z_]{1,40}$'),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  sent_at    timestamptz not null default now()
);

comment on table public.push_ledger is 'Rule-based pushes already sent, for rate limits and de-duplication. Service role only. Rows are deleted with the account.';

create unique index if not exists push_ledger_user_bucket_key_uidx on public.push_ledger (user_id, bucket, dedupe_key);
create index if not exists push_ledger_user_bucket_sent_idx on public.push_ledger (user_id, bucket, sent_at desc);

alter table public.push_ledger enable row level security;
revoke all on public.push_ledger from anon, authenticated;
grant all on public.push_ledger to service_role;
grant usage, select on sequence public.push_ledger_id_seq to service_role;

create or replace function public.claim_push_slots(p_user_ids uuid[], p_bucket text, p_dedupe_key text, p_window_hours integer default 6)
returns table (user_id uuid)
language sql
volatile
security definer
set search_path = public
as $$
  with candidates as (
    select distinct u as uid from unnest(coalesce(p_user_ids, array[]::uuid[])) as u where u is not null
  ),
  free as (
    select c.uid
      from candidates c
     where not exists (
       select 1 from public.push_ledger l
        where l.user_id = c.uid
          and l.bucket = p_bucket
          and (l.dedupe_key = p_dedupe_key or l.sent_at > now() - make_interval(hours => greatest(coalesce(p_window_hours, 0), 0)))
     )
  ),
  claimed as (
    insert into public.push_ledger (user_id, bucket, dedupe_key)
    select f.uid, p_bucket, p_dedupe_key from free f
    on conflict do nothing
    returning public.push_ledger.user_id
  )
  select c.user_id from claimed c;
$$;

revoke all on function public.claim_push_slots(uuid[], text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_push_slots(uuid[], text, text, integer) to service_role;

commit;
