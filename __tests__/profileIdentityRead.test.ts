import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PROFILE_IDENTITY_VIEW, PROFILE_SELECT, PROFILE_SELECT_MINIMAL } from "../lib/profileFields";
import { loadOwnIdentity, loadProfileRowForUser } from "../lib/profileLoad";

type Call = { table: string; cols: string };

/** A client that records every table and column list it is asked for, and answers from a map. */
function client(answers: Record<string, { data: unknown; error: { message: string } | null }>) {
  const calls: Call[] = [];
  const supabase = {
    from: (table: string) => ({
      select: (cols: string) => {
        calls.push({ table, cols });
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.maybeSingle = async () => answers[table] ?? { data: null, error: null };
        return chain;
      },
    }),
  };
  return { supabase: supabase as never, calls };
}

const IDENTITY = /\b(sex|gender|gender_other)\b/;
const base = { first_name: "Ann", last_name: "R", playing_position: null, username: "ann", phone: null, instagram: null, avatar_url: null, tier: null };

describe("signed-in profile load", () => {
  it("never selects sex, gender or gender_other from profiles", () => {
    expect(PROFILE_SELECT).not.toMatch(IDENTITY);
    expect(PROFILE_SELECT_MINIMAL).not.toMatch(IDENTITY);
  });
  it("reads the owner's values from my_profile_identity and merges them", async () => {
    const { supabase, calls } = client({
      profiles: { data: base, error: null },
      [PROFILE_IDENTITY_VIEW]: { data: { sex: "female", gender: "other", gender_other: "x" }, error: null },
    });
    const res = await loadProfileRowForUser(supabase, "u1");
    expect(res.row).toMatchObject({ first_name: "Ann", sex: "female", gender: "other", gender_other: "x" });
    for (const c of calls.filter((x) => x.table === "profiles")) expect(c.cols).not.toMatch(IDENTITY);
    expect(calls.some((c) => c.table === PROFILE_IDENTITY_VIEW)).toBe(true);
  });
  it("falls back to the minimal profile select without identity columns, still reading the view", async () => {
    const calls: Call[] = [];
    let n = 0;
    const supabase = {
      from: (table: string) => ({
        select: (cols: string) => {
          calls.push({ table, cols });
          const chain: Record<string, unknown> = { eq: () => chain };
          chain.maybeSingle = async () =>
            table === PROFILE_IDENTITY_VIEW
              ? { data: { sex: "male", gender: "male", gender_other: null }, error: null }
              : n++ === 0
                ? { data: null, error: { message: "column profiles.esports_interest does not exist" } }
                : { data: base, error: null };
          return chain;
        },
      }),
    } as never;
    const res = await loadProfileRowForUser(supabase, "u1");
    expect(res.row).toMatchObject({ first_name: "Ann", sex: "male", esports_interest: null });
    expect(res.hasEsportsSchema).toBe(false);
    for (const c of calls.filter((x) => x.table === "profiles")) expect(c.cols).not.toMatch(IDENTITY);
  });
  it("keeps working, with empty identity, if the view does not exist yet", async () => {
    const { supabase } = client({
      profiles: { data: base, error: null },
      [PROFILE_IDENTITY_VIEW]: { data: null, error: { message: 'relation "my_profile_identity" does not exist' } },
    });
    const res = await loadProfileRowForUser(supabase, "u1");
    expect(res.error).toBeNull();
    expect(res.row).toMatchObject({ first_name: "Ann", sex: null, gender: null, gender_other: null });
    expect(await loadOwnIdentity(supabase)).toEqual({ sex: null, gender: null, gender_other: null });
  });
  it("returns no row when the profile is missing, and does not invent identity", async () => {
    const { supabase } = client({ profiles: { data: null, error: null } });
    expect((await loadProfileRowForUser(supabase, "u1")).row).toBeNull();
  });
});

/** Source files that run in the web app, the mobile app or API routes. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".expo", "__tests__"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("nothing reads sex, gender or gender_other from profiles", () => {
  it("no .from('profiles') chain selects those columns or everything", () => {
    const offenders: string[] = [];
    for (const root of ["app", "lib", "components", "mobile/app", "mobile/lib", "mobile/components", "mobile/hooks", "mobile/context"]) {
      let files: string[] = [];
      try {
        files = sourceFiles(join(__dirname, "..", root));
      } catch {
        continue;
      }
      for (const f of files) {
        const s = readFileSync(f, "utf8");
        for (const m of s.matchAll(/from\(\s*["']profiles["']\s*\)/g)) {
          const end = s.indexOf(";", m.index! + m[0].length);
          const chain = s.slice(m.index!, end < 0 ? m.index! + 500 : Math.min(end, m.index! + 500));
          for (const sel of chain.matchAll(/\.select\(\s*(?:(["'`])(.*?)\1)?\s*(?:,[^)]*)?\)/gs)) {
            const body = (sel[2] ?? "").trim();
            if (body === "" || body === "*" || IDENTITY.test(body)) offenders.push(`${f.replace(join(__dirname, ".."), "")}: select(${body || ""})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
