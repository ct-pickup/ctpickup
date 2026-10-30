-- Per-category push switches and quiet hours, stored on the player's profile. Additive and idempotent. No CASCADE.
--
--   push_cat_games       new games, invites, confirmations, cancellations, follows, tournaments
--   push_cat_reminders   waitlist spots, reminders to confirm, rate-your-game reminders
--   push_cat_results     results, awards, voting
--   push_cat_chat        chat messages and announcements in chats the player is in
--   push_cat_fields      Fields alerts (new games near me, slot opens, changes) and field request updates
--   (marketing is the existing profiles.marketing_push_enabled; this migration only makes sure the column exists)
--   quiet_hours_*        no pushes between start and end (minutes after midnight, in quiet_hours_tz; null tz means US Eastern).
--                        Urgent pushes (a waitlist spot within 2 hours of kickoff, a cancellation for a game today) still arrive
--                        in quiet hours, but never for a category that is switched off.
--
-- Defaults keep today's behaviour: every category on, quiet hours off. The server enforces all of it in lib/push/sendExpoPush.ts.
-- Also seeds nothing: the 'notification_settings' flag already exists (20261025000100_retention_flags.sql).
--
-- Verify after running:
--   select column_name, data_type, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles' and (column_name like 'push\_cat\_%' or column_name like 'quiet\_hours\_%') order by 1;   -- 9 rows
--   select count(*) from public.profiles where push_cat_games is not true;     -- 0
-- Rollback (manual; drops the stored choices):
--   begin;
--   alter table public.profiles drop constraint if exists profiles_quiet_hours_range;
--   alter table public.profiles drop column if exists push_cat_games, drop column if exists push_cat_reminders, drop column if exists push_cat_results,
--     drop column if exists push_cat_chat, drop column if exists push_cat_fields, drop column if exists quiet_hours_enabled,
--     drop column if exists quiet_hours_start, drop column if exists quiet_hours_end, drop column if exists quiet_hours_tz;
--   commit;
begin;

-- Already there in production (20260520160000); added only so a dev database built from stubs has it too.
alter table public.profiles add column if not exists marketing_push_enabled boolean not null default false;

alter table public.profiles add column if not exists push_cat_games boolean not null default true;
alter table public.profiles add column if not exists push_cat_reminders boolean not null default true;
alter table public.profiles add column if not exists push_cat_results boolean not null default true;
alter table public.profiles add column if not exists push_cat_chat boolean not null default true;
alter table public.profiles add column if not exists push_cat_fields boolean not null default true;
alter table public.profiles add column if not exists quiet_hours_enabled boolean not null default false;
alter table public.profiles add column if not exists quiet_hours_start smallint not null default 1320;
alter table public.profiles add column if not exists quiet_hours_end smallint not null default 420;
alter table public.profiles add column if not exists quiet_hours_tz text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_quiet_hours_range' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_quiet_hours_range
      check (quiet_hours_start between 0 and 1439 and quiet_hours_end between 0 and 1439 and (quiet_hours_tz is null or char_length(quiet_hours_tz) <= 64));
  end if;
end $$;

comment on column public.profiles.quiet_hours_start is 'Quiet hours start, minutes after midnight (0..1439) in quiet_hours_tz.';
comment on column public.profiles.quiet_hours_end is 'Quiet hours end, minutes after midnight (0..1439) in quiet_hours_tz. Start after end means the window crosses midnight.';
comment on column public.profiles.quiet_hours_tz is 'IANA time zone of the quiet hours (the device zone when the player saved). Null means America/New_York.';

commit;
