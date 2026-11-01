import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as webCopy from "../lib/genderPrivacyCopy";
import * as mobileCopy from "../mobile/lib/genderPrivacyCopy";
import {
  GENDER_NOTICE_BODY,
  GENDER_NOTICE_BODY_BLANK,
  GENDER_NOTICE_OK,
  GENDER_NOTICE_SETTINGS,
  GENDER_NOTICE_TITLE,
  genderNoticeBody,
  genderNoticeKey,
  markGenderNoticeSeen,
  shouldShowGenderNotice,
} from "../mobile/lib/genderNoticeCore";
import { readOwnGenderResult } from "../mobile/lib/ownGender";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: async (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: async (k: string, v: string) => void m.set(k, v),
  };
}

describe("gender notice: shown once", () => {
  it("shows the first time, then never again on this device", async () => {
    const storage = memoryStorage();
    expect(await shouldShowGenderNotice(storage, "u1")).toBe(true);
    await markGenderNoticeSeen(storage, "u1");
    expect(await shouldShowGenderNotice(storage, "u1")).toBe(false);
    expect(await shouldShowGenderNotice(storage, "u1")).toBe(false);
    expect(storage.m.get(genderNoticeKey("u1"))).toBe("1");
  });
  it("is remembered per player, so another account on the same device still sees it once", async () => {
    const storage = memoryStorage();
    await markGenderNoticeSeen(storage, "u1");
    expect(await shouldShowGenderNotice(storage, "u2")).toBe(true);
  });
  it("does not nag when storage cannot be read, and never throws when it cannot be written", async () => {
    const broken = { getItem: async () => Promise.reject(new Error("no storage")), setItem: async () => Promise.reject(new Error("no storage")) };
    expect(await shouldShowGenderNotice(broken, "u1")).toBe(false);
    await expect(markGenderNoticeSeen(broken, "u1")).resolves.toBeUndefined();
  });
  it("uses the same device-local pattern as the cancellation policy notice (appAsyncStorage, one key per player)", () => {
    const c = src("mobile/components/GenderNotice.tsx");
    expect(c).toMatch(/appAsyncStorage/);
    expect(c).toMatch(/shouldShowGenderNotice\(appAsyncStorage, userId\)/);
    expect(c).toMatch(/markGenderNoticeSeen\(appAsyncStorage, id\)/);
    expect(src("mobile/components/CancellationPolicyNotice.tsx")).toMatch(/appAsyncStorage/);
    expect(genderNoticeKey("abc")).toBe("ctpickup_gender_notice_v1:abc");
  });
  it("is marked seen on both buttons, and Go to Settings opens settings", () => {
    const c = src("mobile/components/GenderNotice.tsx");
    expect(c).toMatch(/dismiss\(true\)/);
    expect(c).toMatch(/dismiss\(false\)/);
    expect(c).toMatch(/router\.push\("\/settings"\)/);
    expect(c.indexOf("markGenderNoticeSeen")).toBeLessThan(c.indexOf('router.push("/settings")'));
    expect(src("mobile/app/_layout.tsx")).toMatch(/<GenderNotice \/>/);
  });
});

describe("gender notice: text", () => {
  it("has the agreed title, body, blank body and buttons", () => {
    expect(GENDER_NOTICE_TITLE).toBe("Leaderboards now have a Gender filter");
    expect(GENDER_NOTICE_BODY).toBe("Your list is based on the gender you gave at signup. You can change it anytime in Settings.");
    expect(GENDER_NOTICE_BODY_BLANK).toBe("Add your gender in Settings to appear on a gender list.");
    expect(GENDER_NOTICE_OK).toBe("OK");
    expect(GENDER_NOTICE_SETTINGS).toBe("Go to Settings");
  });
  it("a player with a blank gender still sees the notice, with the 'add your gender' body", () => {
    expect(genderNoticeBody(null)).toBe(GENDER_NOTICE_BODY_BLANK);
    expect(genderNoticeBody("")).toBe(GENDER_NOTICE_BODY_BLANK);
    expect(genderNoticeBody(undefined)).toBe(GENDER_NOTICE_BODY_BLANK);
  });
  it("players who gave a gender (including other and prefer not to say) get the standard body", () => {
    for (const g of ["male", "female", "other", "prefer_not_to_say"]) expect(genderNoticeBody(g)).toBe(GENDER_NOTICE_BODY);
  });
  it("if the gender could not be read (view not applied yet), nobody is told to add it", () => {
    expect(genderNoticeBody(null, true)).toBe(GENDER_NOTICE_BODY);
  });
  it("tells a failed read from a blank one", async () => {
    const ok = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { gender: null }, error: null }) }) }) };
    const bad = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) };
    expect(await readOwnGenderResult(ok)).toEqual({ failed: false, value: null });
    expect(await readOwnGenderResult(bad)).toEqual({ failed: true, value: null });
  });
});

describe("web forms and privacy policy", () => {
  it("shows 'Used for gender leaderboards.' under the gender field on signup, profile and onboarding", () => {
    expect(webCopy.GENDER_LEADERBOARD_HINT).toBe("Used for gender leaderboards.");
    for (const f of ["app/signup/page.tsx", "app/profile/page.tsx", "app/onboarding/page.tsx"]) {
      const s = src(f);
      const label = s.search(/>\s*Gender\s*<\/label>/);
      const hint = s.indexOf("{GENDER_LEADERBOARD_HINT}");
      expect(label, f).toBeGreaterThan(-1);
      expect(hint, f).toBeGreaterThan(label);
      expect(hint - label, f).toBeLessThan(900);
    }
  });
  it("adds the gender sentence to the web privacy page and to the in-app privacy policy", () => {
    expect(src("app/privacy/page.tsx")).toMatch(/PRIVACY_GENDER_BODY/);
    expect(src("mobile/app/privacy-policy.tsx")).toMatch(/PRIVACY_GENDER_BODY/);
    expect(webCopy.PRIVACY_GENDER_BODY).toMatch(/filter leaderboards by gender/);
    expect(webCopy.PRIVACY_GENDER_BODY).toMatch(/change it at any time/);
    expect(webCopy.PRIVACY_GENDER_BODY).toMatch(/"Prefer not to say"/);
    expect(webCopy.PRIVACY_GENDER_BODY).toMatch(/in Settings/);
  });
  it("the web and mobile copies are identical", () => {
    expect(mobileCopy.GENDER_LEADERBOARD_HINT).toBe(webCopy.GENDER_LEADERBOARD_HINT);
    expect(mobileCopy.PRIVACY_GENDER_TITLE).toBe(webCopy.PRIVACY_GENDER_TITLE);
    expect(mobileCopy.PRIVACY_GENDER_BODY).toBe(webCopy.PRIVACY_GENDER_BODY);
    expect(src("lib/genderPrivacyCopy.ts")).toBe(src("mobile/lib/genderPrivacyCopy.ts"));
  });
});

describe("copy rules", () => {
  it("has no em dash and no tier or wave wording", () => {
    const all = [
      GENDER_NOTICE_TITLE,
      GENDER_NOTICE_BODY,
      GENDER_NOTICE_BODY_BLANK,
      GENDER_NOTICE_OK,
      GENDER_NOTICE_SETTINGS,
      webCopy.GENDER_LEADERBOARD_HINT,
      webCopy.PRIVACY_GENDER_TITLE,
      webCopy.PRIVACY_GENDER_BODY,
    ];
    for (const t of all) expect(t).not.toMatch(/—|\btier\b|\bwave\b/i);
  });
});
