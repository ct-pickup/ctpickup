import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, uuid } from "./harness";

const file = readFileSync("scripts/dev/rating_distribution_readonly.sql", "utf8");
const code = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const bare = code.replace(/'(?:[^']|'')*'/g, "''");

describe("scripts/dev/rating_distribution_readonly.sql", () => {
  it("is one SELECT and nothing that writes", () => {
    expect(bare.trim().startsWith("with ratings")).toBe(true);
    expect(bare.trim().endsWith(";")).toBe(true);
    expect(bare.trim().slice(0, -1)).not.toContain(";");
    expect(bare).not.toMatch(/\b(insert|update|delete|create|drop|alter|truncate|grant|revoke|copy|call|do|vacuum|set)\b\s/i);
    expect(file).toMatch(/READ ONLY/);
    expect(file).toMatch(/ONE SELECT statement/);
  });
  it("reads only player_ratings and rating_events", () => {
    const tables = [...code.matchAll(/\b(?:from|join)\s+(public\.[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(tables)].sort()).toEqual(["public.player_ratings", "public.rating_events"]);
  });
});

const ids = Array.from({ length: 5 }, (_, i) => uuid(5000 + i));
const TS = uuid(5100);

describe.skipIf(!SQL_TESTS_ENABLED)("distribution against fixtures (real Postgres)", () => {
  it("counts the ends of the scale and who hit 100 within five sessions", () => {
    // p0: 100 in the first session. p1: 100 in the 3rd. p2: 100 only in the 6th. p3: fell to 0 in the 2nd. p4: no sessions.
    const ev = (u: string, n: number, after: number) => `insert into public.rating_events (session_id, user_id, votes_received, votes_expected, organizer_score, peer_weight, k_factor, delta, score_before, score_after, created_at)
      select s, '${u}', 0, 1, 5, 0.5, 16, 0, 50, ${after}, now() - interval '${60 - n} days' from (select gen_random_uuid() as s) q;`;
    const out = sql(`
      insert into auth.users (id) values ${ids.map((i) => `('${i}')`).join(",")};
      insert into public.profiles (id, approved) values ${ids.map((i) => `('${i}', true)`).join(",")};
      insert into public.player_ratings (user_id, score, sessions, reliability) values ('${ids[0]}', 100, 5, 92), ('${ids[1]}', 100, 5, 92), ('${ids[2]}', 97, 8, 92), ('${ids[3]}', 0, 4, 92), ('${ids[4]}', 50, 0, 92);
      insert into public.tier_sessions (id, organizer_id, venue, starts_at, capacity, state) values ('${TS}', '${ids[0]}', 'v', now(), 20, 'settled');
      alter table public.rating_events drop constraint if exists rating_events_session_id_fkey;
      ${ev(ids[0]!, 1, 100)}
      ${ev(ids[1]!, 1, 70)} ${ev(ids[1]!, 2, 85)} ${ev(ids[1]!, 3, 100)}
      ${[1, 2, 3, 4, 5].map((n) => ev(ids[2]!, n, 60 + n)).join("\n")} ${ev(ids[2]!, 6, 100)}
      ${ev(ids[3]!, 1, 20)} ${ev(ids[3]!, 2, 0)}
      ${file.replace(/;\s*$/, "")} ;`).filter((l) => l.includes("|"));
    const get = (section: string, metric: string) => out.find((l) => l.startsWith(`${section}|${metric}|`))!.split("|")[2];
    expect(get("scale", "players rated")).toBe("5");
    expect(get("scale", "at exactly 100")).toBe("2");
    expect(get("scale", "at exactly 0")).toBe("1");
    expect(get("first5", "players with at least one rated session")).toBe("4");
    expect(get("first5", "reached 100 within their first 5 rated sessions")).toBe("2");
    expect(get("first5", "reached 100 in their very first rated session")).toBe("1");
    expect(get("first5", "fell to 0 within the first 5, share")).toBe("25.0%");
    expect(get("first5", "median rated session at which 100 was first reached")).toBe("2.0");
    expect(get("sessions", "no rated sessions")).toBe("1");
    expect(out.some((l) => l.startsWith("stars|star band"))).toBe(true);
  });
  it("runs on an empty database", () => {
    const out = sql(`${file.replace(/;\s*$/, "")} ;`).filter((l) => l.includes("|"));
    expect(out.find((l) => l.startsWith("scale|players rated|"))!.split("|")[2]).toBe("0");
  });
});
