# Scratch database for the SQL tests

The SQL tests (`__tests__/sql`) run against a real Postgres, only when `TEST_DATABASE_URL` is set, and refuse a URL that looks like production.
`setup.sh` builds a throwaway local database that has the migrations the rated tournament tests need, plus:

- `00_stubs.sql`: the Supabase pieces the migrations assume (roles, `auth.users`, `auth.uid()`, `profiles`, `pickup_runs`, `pickup_run_rsvps`).
- `05_tournament_stubs.sql`: stand-ins for the production tournament tables, which are not in the migrations.
- `20_production_shape.sql`: production's exact policy and trigger names, with row level security on. The two triggers whose bodies are not
  in this repo (`trg_ensure_player_rating`, `trg_sync_pickup_runs_legacy_cols`) are stand-ins that only write to `prod_shape_trigger_log`.

Run the tests one file at a time (`--no-file-parallelism`): they share the rating switches and deadlock otherwise.
