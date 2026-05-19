-- Account deletion: relax RESTRICT FKs so orphaned esports rows can be anonymized and
-- platform_payments do not block profile removal.

-- esports_matches: allow deleted players to be cleared from scheduled matches
alter table public.esports_matches
  alter column player1_user_id drop not null,
  alter column player2_user_id drop not null;

alter table public.esports_matches drop constraint if exists esports_matches_player1_user_id_fkey;
alter table public.esports_matches drop constraint if exists esports_matches_player2_user_id_fkey;

alter table public.esports_matches
  add constraint esports_matches_player1_user_id_fkey
    foreign key (player1_user_id) references auth.users (id) on delete set null,
  add constraint esports_matches_player2_user_id_fkey
    foreign key (player2_user_id) references auth.users (id) on delete set null;

-- esports_match_reports: remove reports when the reporter account is deleted
alter table public.esports_match_reports drop constraint if exists esports_match_reports_reporter_user_id_fkey;

alter table public.esports_match_reports
  add constraint esports_match_reports_reporter_user_id_fkey
    foreign key (reporter_user_id) references auth.users (id) on delete cascade;

-- esports_match_results: keep result history with anonymized submitter
alter table public.esports_match_results
  alter column submitted_by_user_id drop not null;

alter table public.esports_match_results drop constraint if exists esports_match_results_submitted_by_user_id_fkey;

alter table public.esports_match_results
  add constraint esports_match_results_submitted_by_user_id_fkey
    foreign key (submitted_by_user_id) references auth.users (id) on delete set null;

-- esports_conduct_records: keep records when the issuing admin account is deleted
alter table public.esports_conduct_records
  alter column created_by_admin_user_id drop not null;

alter table public.esports_conduct_records drop constraint if exists esports_conduct_records_created_by_admin_user_id_fkey;

alter table public.esports_conduct_records
  add constraint esports_conduct_records_created_by_admin_user_id_fkey
    foreign key (created_by_admin_user_id) references auth.users (id) on delete set null;

-- platform_payments: financial rows removed with the profile
alter table public.platform_payments drop constraint if exists platform_payments_user_id_fkey;

alter table public.platform_payments
  add constraint platform_payments_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade;
