import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RATED_LOCKED_TEXT,
  TOURNAMENT_DAILY_MAX_DELTA,
  isScoredMatch,
  ratedChangeAllowed,
  ratingOptionsView,
  ratingReasonText,
} from "../../shared/ratedTournament";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261106000000_rated_tournaments.sql");
const code = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const body = code(migration);

describe("the words and the two rules the admin screen uses", () => {
  it("Rated can change only while no match has a score; a bye or an unscored match is not scored", () => {
    expect(ratedChangeAllowed(0)).toBe(true);
    expect(ratedChangeAllowed(1)).toBe(false);
    expect(isScoredMatch({ completed_at: "2026-11-14T20:00:00Z", is_bye: false })).toBe(true);
    expect(isScoredMatch({ completed_at: "2026-11-14T20:00:00Z", is_bye: true })).toBe(false);
    expect(isScoredMatch({ completed_at: null })).toBe(false);
  });

  it("the locked explanation says why in plain words, and Counts for season is never locked", () => {
    const v = ratingOptionsView({ rated: true, count_for_season: false, scored_matches: 3 });
    expect(v.rated_locked).toBe(true);
    expect(v.rated_note).toBe(RATED_LOCKED_TEXT);
    expect(RATED_LOCKED_TEXT).toMatch(/already has a score/);
    expect(RATED_LOCKED_TEXT).toMatch(/halfway through an event/);
    expect(v.season_note).toMatch(/at any time/);
    const open = ratingOptionsView({ rated: false, count_for_season: true, scored_matches: 0 });
    expect(open.rated_locked).toBe(false);
    expect(open.rated_label).toBe("Rated: off");
    expect(open.season_label).toBe("Counts for season: on");
  });

  it("every reason code has a sentence, and none of them holds a number from a rating", () => {
    for (const r of ["not_rated", "ratings_off", "not_scored", "too_few_players", "teams_uneven", "teams_incomplete", "not_counted"]) {
      const t = ratingReasonText(r);
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/\d/);
    }
    expect(ratingReasonText(null)).toBe("Counted for ratings.");
    expect(ratingReasonText("something_new")).toBe("Not counted.");
  });
});

describe("4. the daily cap is one named number", () => {
  it("the migration seeds the one rating_config row, and the app's copy matches it", () => {
    const seed = migration.match(/\('tournament_daily_max_delta',\s*([0-9.]+),/);
    expect(seed).not.toBeNull();
    expect(Number(seed![1])).toBe(TOURNAMENT_DAILY_MAX_DELTA);
    expect(TOURNAMENT_DAILY_MAX_DELTA).toBe(3);
  });

  it("the rating step reads the cap through the one function and never has its own copy of the number", () => {
    expect(body).toMatch(/day_cap := public\.tournament_daily_max_delta\(\)/);
    expect(body).toMatch(/greatest\(-day_cap - prior, least\(day_cap - prior, target\)\)/);
    // the function raises when the row is missing instead of falling back to a second number
    expect(body).toMatch(/raise exception 'rating_config is missing tournament_daily_max_delta'/);
    expect(body.match(/tournament_daily_max_delta/g)!.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the migration is a file, safe to run twice, and guarded", () => {
  it("has a rollback block at the top and the three pieces that need production tables are guarded by to_regclass", () => {
    expect(migration.indexOf("-- Rollback")).toBeGreaterThan(0);
    expect(migration.indexOf("-- Rollback")).toBeLessThan(migration.indexOf("begin;"));
    expect(body).toMatch(/to_regclass\('public\.rating_config'\) is not null/);
    expect(body).toMatch(/to_regclass\('public\.tournaments'\) is not null and to_regclass\('public\.tier_sessions'\) is not null/);
    expect(body).toMatch(/to_regclass\('public\.tournament_matches'\) is not null/);
    expect(body).toMatch(/to_regclass\('public\.tournament_match_runs'\) is not null/);
    expect(body).toMatch(/^begin;$/m);
    expect(body).toMatch(/^commit;$/m);
  });

  it("only adds or replaces: no drop, truncate or delete of existing data outside the new functions and policies", () => {
    expect(body).not.toMatch(/\balter table public\.(tournaments|pickup_runs|tournament_matches)\b/);
    expect(body).not.toMatch(/\btruncate\b/i);
    for (const m of body.matchAll(/\bdrop (table|column|function|trigger)\b/gi)) throw new Error(`unexpected ${m[0]}`);
    // the only drops are the policies this file re-creates
    for (const m of body.matchAll(/drop policy if exists (\w+) on public\.(\w+)/g)) expect(m[1]).toBe("tournament_match_runs_hidden");
  });

  it("new tables are closed to clients", () => {
    for (const t of ["tournament_rating_days", "tournament_match_rating"]) {
      expect(body).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(body).toMatch(new RegExp(`revoke all on table public\\.${t} from anon, authenticated`));
    }
  });

  it("hides tournament match records from clients with restrictive policies on all three tables", () => {
    for (const t of ["pickup_runs", "pickup_run_results", "pickup_run_team_assignments"]) {
      expect(body).toMatch(new RegExp(`create policy tournament_match_runs_hidden on public\\.${t} as restrictive for select to anon, authenticated`));
    }
  });
});

describe("6. nobody is marked present or absent by a tournament", () => {
  it("the SQL never writes a no_show, an absent flag, reliability or the sessions count", () => {
    expect(body).not.toMatch(/no_show/);
    expect(body).not.toMatch(/reliability\s*=/);
    // the only writes to player_ratings are the score (the existing result path, and taking it back out): never reliability or sessions
    for (const m of body.matchAll(/update public\.player_ratings set([^;]*);/g)) expect(m[1]).not.toMatch(/reliability|sessions|star_provisional/);
    expect(body).not.toMatch(/sessions\s*=\s*\w*sessions\s*\+/);
    expect(body).not.toMatch(/pickup_run_attendance/);
    // attendance is written only for players on a team of the match being rated
    expect(body).toMatch(/insert into public\.session_attendance \(session_id, user_id, status\)\s+select v_sid, a\.user_id, 'attended' from public\.pickup_run_team_assignments a where a\.run_id = v_run/);
  });
});

describe("7. the results-entered cap and 9. the verified rule are explicit in the SQL", () => {
  it("tournament matches skip the poster cap and are not counted by it", () => {
    expect(body).toMatch(/\(is_t or rec\.host_results <= \(cfg ->> 'result_host_max_30d'\)::numeric\)/);
    expect(body).toMatch(/and not public\.is_tournament_run\(r3\.run_id\)/);
  });

  it("an admin entered tournament score counts as verified; every other game still needs both captains", () => {
    expect(body).toMatch(/case when is_t then t_rated and t_done else res\.verified_at is not null end/);
  });

  it("the minimum number of players is counted per match for a tournament", () => {
    expect(body).toMatch(/if is_t then n_att := coalesce\(n_a, 0\) \+ coalesce\(n_b, 0\); end if;/);
  });

  it("the existing per game cap, k share and team rule are read from rating_config exactly as before", () => {
    for (const k of ["result_max_delta", "result_k_share", "result_scale", "result_min_attendance", "result_max_team_diff", "result_host_max_30d"]) {
      expect(body).toContain(`cfg ->> '${k}'`);
    }
  });
});

describe("11 and 12. nothing here sends a push or hands a rating to a client", () => {
  it("the server module imports no push code and returns codes only", () => {
    const mod = read("lib/tournament/ratedTournament.ts");
    expect(mod).not.toMatch(/sendExpoPush|sendPush|@\/lib\/push|expo_push|notification/i);
    expect(mod).not.toMatch(/player_ratings|rating_events|rating_result_adjustments|score_before/);
  });

  it("the SQL never calls a push or notification function", () => {
    expect(body).not.toMatch(/push|notif|expo/i);
  });

  it("the player-facing bracket route and its allow-list are untouched by rated tournaments", () => {
    for (const f of ["app/api/tournament/bracket/route.ts", "lib/tournament/publicBracket.ts"]) {
      expect(read(f)).not.toMatch(/rated|count_for_season|rating_options|tournament_match_rating|ratedTournament/);
    }
  });

  it("only the admin route returns the switches, and it returns words and codes", () => {
    const route = read("app/api/admin/tournaments/bracket/route.ts");
    expect(route).toMatch(/rating_options/);
    expect(route).toMatch(/Codes only: no rating is ever sent to a client/);
  });
});

describe("14. nothing is applied, and the test scripts take the ratings back", () => {
  it("cleanup.sql takes rating effects back out BEFORE it deletes the links to the hidden game records", () => {
    const cleanup = read("scripts/test-tournament/cleanup.sql");
    const unrate = cleanup.indexOf("tournament_unrate_tournament");
    expect(unrate).toBeGreaterThan(0);
    expect(unrate).toBeLessThan(cleanup.indexOf("-- Children first"));
    expect(cleanup).toMatch(/to_regprocedure\('public\.tournament_unrate_tournament\(uuid\)'\) is not null/);
  });
});

describe("the style rules for new text", () => {
  it("has no em dashes in anything this change adds", () => {
    for (const f of [
      "shared/ratedTournament.ts",
      "lib/tournament/ratedTournament.ts",
      "supabase/migrations/20261106000000_rated_tournaments.sql",
      "__tests__/sql/ratedTournaments.sql.test.ts",
    ]) {
      expect(read(f), f).not.toMatch(/\u2014/);
    }
  });
});
