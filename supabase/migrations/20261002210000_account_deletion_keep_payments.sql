-- Account deletion keeps payment history. The app anonymizes platform_payments rows and RSVPs on past runs
-- (user_id set to null, personal metadata stripped) before it deletes the profile and auth user, instead of deleting
-- them. This migration lets those rows exist without a user and stops any remaining cascade from deleting them.
-- Until it runs, account deletion refuses to start (account_deletion_anonymize_ready is missing).

begin;

-- platform_payments.user_id was NOT NULL and cascaded from profiles (20260520150000), so deleting a profile deleted
-- the user's payments.
alter table public.platform_payments alter column user_id drop not null;
alter table public.platform_payments drop constraint if exists platform_payments_user_id_fkey;
alter table public.platform_payments
  add constraint platform_payments_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

-- pickup_run_rsvps and pickup_runs were created outside migrations, so their foreign keys are found by column.
-- Any FK on pickup_run_rsvps.user_id becomes ON DELETE SET NULL; pickup_runs.created_by only if it cascades, so a
-- deleted host no longer deletes their past runs (which the delete guard trigger would refuse anyway).
alter table public.pickup_run_rsvps alter column user_id drop not null;

do $$
declare
  c record;
begin
  for c in
    select con.conname, con.conrelid::regclass as tbl, att.attname as col, con.confrelid::regclass as ref,
           con.confdeltype
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and array_length(con.conkey, 1) = 1
      and (
        (con.conrelid = 'public.pickup_run_rsvps'::regclass and att.attname = 'user_id')
        or (con.conrelid = 'public.pickup_runs'::regclass and att.attname = 'created_by' and con.confdeltype = 'c')
      )
  loop
    execute format('alter table %s alter column %I drop not null', c.tbl, c.col);
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s (id) on delete set null',
      c.tbl, c.conname, c.col, c.ref
    );
  end loop;
end $$;

-- pickup_credits.credited_for_user_id references auth.users with no delete action, so a payer's credit for a friend's
-- spot blocked deleting that friend. Setting it to null would turn the credit into the payer's own-spot credit and can
-- collide with pickup_credits_user_cancelled_run_player_unique, so the FK is dropped and the id kept as a plain value.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.conrelid = 'public.pickup_credits'::regclass
      and att.attname = 'credited_for_user_id'
  loop
    execute format('alter table public.pickup_credits drop constraint %I', c.conname);
  end loop;
end $$;

create or replace function public.account_deletion_anonymize_ready()
returns boolean
language sql
stable
as $$ select true $$;

revoke all on function public.account_deletion_anonymize_ready() from public, anon, authenticated;
grant execute on function public.account_deletion_anonymize_ready() to service_role;

commit;

-- Rollback (not run). Restoring NOT NULL fails once any anonymized row exists; those rows are kept on purpose.
--
-- begin;
-- drop function if exists public.account_deletion_anonymize_ready();
-- alter table public.platform_payments drop constraint if exists platform_payments_user_id_fkey;
-- alter table public.platform_payments
--   add constraint platform_payments_user_id_fkey
--   foreign key (user_id) references public.profiles (id) on delete cascade;
-- alter table public.pickup_credits
--   add constraint pickup_credits_credited_for_user_id_fkey
--   foreign key (credited_for_user_id) references auth.users (id) not valid;
-- commit;
