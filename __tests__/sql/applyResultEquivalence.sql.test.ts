import { describe, expect, it } from "vitest";

import { FLAGS, HOST_ROWS, CASES, deployedApply, deployedRefresh, game, run, ten, type Spec } from "./equivalenceHelpers";
import { SQL_TESTS_ENABLED, sql, uuid } from "./harness";

/**
 * Proof that the replaced apply_result_rating gives every ordinary (non tournament) game the same answer as the one deployed today
 * (the last definition before 20261106000000: 20261101000300). Both versions run in the same database on identical inputs: game 0 goes
 * through the deployed text (installed here under another name), game 1 through the new function. Their adjustments, signals, expectations
 * and the players' final ratings must match to the last digit. The same is done for refresh_player_game_stats.
 */

describe.skipIf(!SQL_TESTS_ENABLED)("the new apply_result_rating equals the deployed one for every ordinary game (real Postgres)", () => {
  for (const [name, spec, check] of CASES) {
    it(name, () => {
      const r = run(spec);
      expect(r.first[1]).toEqual(r.first[0]); // same adjustments, signals, expectations and ratings, player by player
      expect(r.moved[1]).toBe(r.moved[0]);
      expect(r.edited[1]).toEqual(r.edited[0]);
      check(r);
    });
  }

  it("refresh_player_game_stats writes the same rows for an ordinary game", () => {
    const s: Spec = { scores: ten(60, 45), sessions: 2 };
    const out = sql(`${deployedRefresh} ${deployedApply} ${HOST_ROWS} ${game(0, s)} ${game(1, s)} ${FLAGS}
      select 'n|0|' || public.refresh_player_game_stats_deployed('${uuid(9500)}'); select 'n|1|' || public.refresh_player_game_stats('${uuid(9501)}');
      select 'row|' || (case when run_id = '${uuid(9500)}' then 0 else 1 end) || '|' || (row_number() over (partition by run_id order by user_id) - 1) || '|' || team || '|' || coalesce(partner_avg::text, 'n') || '|' || coalesce(opponent_avg::text, 'n') || '|' || coalesce(expected::text, 'n') || '|' || coalesce(actual::text, 'n') || '|' || coalesce(outcome, 'n') || '|' || coalesce(result_signal::text, 'n') || '|' || verified
        from public.player_game_stats order by run_id, user_id;`);
    expect(out.find((l) => l.startsWith("n|0|"))).toBe("n|0|10");
    expect(out.find((l) => l.startsWith("n|1|"))).toBe("n|1|10");
    const rows = (g: number) => out.filter((l) => l.startsWith(`row|${g}|`)).map((l) => l.split("|").slice(2).join("|"));
    expect(rows(1)).toHaveLength(10);
    expect(rows(1)).toEqual(rows(0));
  });
});
