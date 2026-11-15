#!/bin/bash
# Builds a throwaway local Postgres database shaped like production for the rated tournament SQL tests.
#   __tests__/sql/scratch-setup/setup.sh [dbname]        (default: scratch)
# Then:  TEST_DATABASE_URL="postgresql:///scratch" npx vitest run --no-file-parallelism __tests__/sql
# Needs a local Postgres you can create databases in (psql and createdb on the PATH). NEVER point this at a real database: it drops and
# recreates the database named on the command line. The harness refuses a TEST_DATABASE_URL that looks like production.
set -u
DB="${1:-scratch}"
DIR="$(cd "$(dirname "$0")" && pwd)"
MIG="$DIR/../../../supabase/migrations"
dropdb --if-exists "$DB" 2>/dev/null; createdb "$DB" || exit 1
run() { psql -q -d "$DB" -f "$1" 2>&1 | grep -i "error" | grep -v "already exists" | head -3; }

psql -q -d "$DB" -f "$DIR/00_stubs.sql" >/dev/null 2>&1
psql -q -d "$DB" -c "create or replace function public.fields_touch_updated_at() returns trigger language plpgsql as \$\$ begin new.updated_at := now(); return new; end \$\$;" >/dev/null
# app_flags: only the table part of that migration (the rest needs tables this setup does not have)
sed -n 1,98p "$MIG/20261024000000_app_flags.sql" > /tmp/app_flags_head_$$.sql; echo "commit;" >> /tmp/app_flags_head_$$.sql

for f in 20260508120000_pickup_run_results.sql 20260708000001_tier_system.sql 20261003000000_points_events.sql; do run "$MIG/$f"; done
run /tmp/app_flags_head_$$.sql; rm -f /tmp/app_flags_head_$$.sql
for f in 20261002150000_star_ratings.sql 20261101000000_rating_v2.sql 20261101000100_rating_results.sql 20261101000200_player_game_stats.sql \
         20261101000300_rating_v2_expectations.sql 20261002220000_pickup_result_scores_draws.sql 20260708000000_sessions_map.sql \
         20261026000100_analytics_triggers.sql; do run "$MIG/$f"; done
psql -q -d "$DB" -c "create table if not exists public.platform_payments (product_entity_id text, metadata jsonb);" >/dev/null
run "$MIG/20261002200000_pickup_run_delete_guard.sql"
psql -q -d "$DB" -f "$DIR/05_tournament_stubs.sql" >/dev/null 2>&1
psql -q -d "$DB" -c "alter table public.tournament_roster add column if not exists tournament_id uuid, add column if not exists invited_at timestamptz, add column if not exists responded_at timestamptz;" >/dev/null
run "$MIG/20261104000000_tournament_rated_and_match_runs.sql"
run "$DIR/20_production_shape.sql"
run "$MIG/20261106000000_rated_tournaments.sql"
echo "Built $DB. Run: TEST_DATABASE_URL=\"postgresql:///$DB\" npx vitest run --no-file-parallelism __tests__/sql"
