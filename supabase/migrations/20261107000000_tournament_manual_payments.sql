-- Tournaments: "payments handled outside the app". Additive and safe to run twice. NOT applied by this change; it is a file only.
--
-- Two columns on tournaments:
--   payment_mode          text not null default 'stripe'   'stripe' (captains pay by card in the app: today's behavior, the default for
--                                                          every existing and every new tournament) or 'manual' (the organizer collects the
--                                                          money by Venmo or cash and marks each team paid by hand).
--   payment_instructions  text                             Free text the organizer writes (for example a Venmo handle and the amount).
--                                                          Shown only to a captain whose claim the organizer approved. Never public.
--
-- WHY A MIGRATION: no existing tournaments column is both free text and private. format_summary and staff_announcement are shown to every
-- player, and a value stuffed into a number column (entry_fee_cents) could not hold the instructions anyway. The code does not need
-- this migration to keep working: with the columns missing, every tournament reads as 'stripe' and nothing changes. Choosing "I collect
-- it myself" before the migration is applied fails with a clear message instead of silently charging by card.
--
-- Who marked a team paid, and when, is NOT a column here: it goes to admin_audit_log (existing), and the team's own
-- payment_method = 'manual' and payment_received_at (existing columns, the ones the Stripe webhook also sets) say how and when.
--
-- Verify after running:
--   select column_name, data_type, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'tournaments' and column_name in ('payment_mode', 'payment_instructions');
--   select payment_mode, count(*) from public.tournaments group by 1;        -- every existing row: stripe
--
-- Rollback (manual). Only safe while no tournament uses 'manual' (otherwise its teams lose the way they were told to pay):
--   begin;
--   do $rb$
--   begin
--     if to_regclass('public.tournaments') is not null then
--       alter table public.tournaments drop constraint if exists tournaments_payment_mode_check;
--       alter table public.tournaments drop column if exists payment_instructions;
--       alter table public.tournaments drop column if exists payment_mode;
--     end if;
--   end
--   $rb$;
--   commit;

begin;

do $cols$
begin
  if to_regclass('public.tournaments') is not null then
    alter table public.tournaments add column if not exists payment_mode text not null default 'stripe';
    alter table public.tournaments add column if not exists payment_instructions text;
    if not exists (select 1 from pg_constraint where conname = 'tournaments_payment_mode_check' and conrelid = 'public.tournaments'::regclass) then
      alter table public.tournaments add constraint tournaments_payment_mode_check check (payment_mode in ('stripe', 'manual'));
    end if;
    comment on column public.tournaments.payment_mode is 'stripe: captains pay by card in the app (default). manual: the organizer collects payment outside the app and marks teams paid.';
    comment on column public.tournaments.payment_instructions is 'Private free text shown only to an approved captain when payment_mode is manual. Never returned by a public route.';
  end if;
end
$cols$;

commit;
