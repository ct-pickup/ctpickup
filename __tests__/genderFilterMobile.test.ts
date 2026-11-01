import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyGenderFilter, loadGenderIds, parseGenderFilter } from "../lib/leaderboards/genderFilter";
import {
  GENDER_FILTER_EMPTY_BODY,
  GENDER_FILTER_EMPTY_TITLE,
  GENDER_FILTER_OPTIONS,
  GENDER_SAVE_ERROR,
  GENDER_SETTING_HELP,
  GENDER_SETTING_OPTIONS,
  genderChipLabel,
  genderSettingLabel,
} from "../mobile/lib/genderFilterCopy";
import { readOwnGender, writeOwnGender } from "../mobile/lib/ownGender";
import { fakeClient, makeDb } from "./helpers/fakeSupabase";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("parseGenderFilter / applyGenderFilter (server)", () => {
  it("only exactly male or female filter; everything else is all", () => {
    expect(parseGenderFilter("male")).toBe("male");
    expect(parseGenderFilter("female")).toBe("female");
    for (const v of [null, undefined, "", "all", "Male", "FEMALE", "other", "prefer_not_to_say", "women"]) expect(parseGenderFilter(v)).toBe("all");
  });
  it("keeps exactly the matching players, and returns everyone for all", async () => {
    const db = makeDb({
      profiles: [
        { id: "a", gender: "male" },
        { id: "b", gender: "female" },
        { id: "c", gender: "other" },
        { id: "d", gender: "prefer_not_to_say" },
        { id: "e", gender: null },
      ],
    });
    const admin = fakeClient(db) as never;
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }, { id: "f" }];
    expect((await applyGenderFilter(admin, list, "male")).map((p) => p.id)).toEqual(["a"]);
    expect((await applyGenderFilter(admin, list, "female")).map((p) => p.id)).toEqual(["b"]);
    expect((await applyGenderFilter(admin, list, "all")).map((p) => p.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect([...(await loadGenderIds(admin, "male"))]).toEqual(["a"]);
  });
  it("a read error gives an empty list, never everyone", async () => {
    const db = makeDb({});
    db.failTables.profiles = "permission denied";
    expect(await applyGenderFilter(fakeClient(db) as never, [{ id: "a" }], "female")).toEqual([]);
  });
});

describe("settings gender: reads and writes only the player's own value", () => {
  it("reads from the my_profile_identity view, never from profiles", async () => {
    const calls: string[] = [];
    const supabase = {
      from: (t: string) => {
        calls.push(t);
        return { select: () => ({ maybeSingle: async () => ({ data: { gender: "female" }, error: null }) }) };
      },
    };
    expect(await readOwnGender(supabase)).toBe("female");
    expect(calls).toEqual(["my_profile_identity"]);
  });
  it("an unset, unknown or failed read is 'not set'", async () => {
    const mk = (res: unknown) => ({ from: () => ({ select: () => ({ maybeSingle: async () => res }) }) });
    expect(await readOwnGender(mk({ data: { gender: null }, error: null }))).toBeNull();
    expect(await readOwnGender(mk({ data: { gender: "robot" }, error: null }))).toBeNull();
    expect(await readOwnGender(mk({ data: null, error: { message: "relation does not exist" } }))).toBeNull();
    expect(genderSettingLabel(null)).toBe("Not set");
  });
  it("writes the value to the player's own profiles row only", async () => {
    const seen: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = [];
    const supabase = {
      from: (table: string) => ({
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: unknown) => ({
            select: async () => {
              seen.push({ table, patch, id });
              return { data: [{ id }], error: null };
            },
          }),
        }),
      }),
    };
    expect(await writeOwnGender(supabase, "me", "female")).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ table: "profiles", id: "me" });
    expect(seen[0]!.patch).toMatchObject({ gender: "female", gender_other: null });
    expect(Object.keys(seen[0]!.patch).sort()).toEqual(["gender", "gender_other", "updated_at"]);
    await writeOwnGender(supabase, "me", "other");
    expect(seen[1]!.patch).not.toHaveProperty("gender_other"); // keeps their own description when they choose Other
  });
  it("reports a failed or empty write", async () => {
    const failing = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: "denied" } }) }) }) }) };
    expect((await writeOwnGender(failing, "me", "male")).ok).toBe(false);
    const empty = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) };
    expect((await writeOwnGender(empty, "me", "male")).ok).toBe(false);
    expect((await writeOwnGender(empty, "", "male")).ok).toBe(false);
  });
  it("the settings screen uses these helpers and never selects gender from profiles", () => {
    const s = src("mobile/app/settings.tsx");
    expect(s).toMatch(/readOwnGender\(supabase\)/);
    expect(s).toMatch(/writeOwnGender\(supabase, uid, next\)/);
    expect(s).not.toMatch(/from\("profiles"\)\.select\([^)]*gender/);
  });
});

describe("copy and removal", () => {
  it("offers All, Male, Female on the leaderboard and Male, Female, Other, Prefer not to say in Settings", () => {
    expect(GENDER_FILTER_OPTIONS.map((o) => o.label)).toEqual(["All", "Male", "Female"]);
    expect(GENDER_SETTING_OPTIONS.map((o) => o.label)).toEqual(["Male", "Female", "Other", "Prefer not to say"]);
    expect(genderChipLabel("all")).toBe("Gender: All");
    expect(genderChipLabel("female")).toBe("Gender: Female");
  });
  it("the Settings help line is the agreed one", () => {
    expect(GENDER_SETTING_HELP).toBe("Used for gender leaderboards. Others can see which list you appear on.");
  });
  it("has no em dash and no tier or wave wording", () => {
    const all = [
      ...GENDER_FILTER_OPTIONS.map((o) => o.label),
      ...GENDER_SETTING_OPTIONS.map((o) => o.label),
      GENDER_FILTER_EMPTY_TITLE,
      GENDER_FILTER_EMPTY_BODY,
      GENDER_SETTING_HELP,
      GENDER_SAVE_ERROR,
      genderChipLabel("male"),
    ];
    for (const t of all) expect(t).not.toMatch(/—|\btier\b|\bwave\b/i);
  });
  it("the Women chip, the opt-in switch, scope=women and womensList are gone, and the opt-in migration is untouched", () => {
    expect(existsSync(new URL("../lib/leaderboards/womensList.ts", import.meta.url))).toBe(false);
    expect(src("app/api/leaderboards/route.ts")).not.toMatch(/scope|womens|loadWomensOptInIds/i);
    for (const f of ["mobile/app/(tabs)/leaderboards.tsx", "mobile/app/settings.tsx", "mobile/components/account/PreferencesSection.tsx"]) {
      expect(src(f), f).not.toMatch(/women|womens_leaderboard_opt_in|Show me on the/i);
    }
    expect(existsSync(new URL("../supabase/migrations/20261103000000_womens_leaderboard_opt_in.sql", import.meta.url))).toBe(true);
  });
  it("the leaderboard screen sends the gender filter and shows a friendly empty state", () => {
    const s = src("mobile/app/(tabs)/leaderboards.tsx");
    expect(s).toMatch(/searchParams\.set\("gender", genderFilter\)/);
    expect(s).toMatch(/GENDER_FILTER_EMPTY_TITLE/);
    expect(s).toMatch(/useState<GenderFilterValue>\("all"\)/);
  });
});
