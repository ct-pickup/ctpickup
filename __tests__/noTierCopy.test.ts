import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Players must never see tier or wave wording. These are the files whose strings reach players (pushes, error messages shown to
 * hosts and voters, public pages, plan copy). Code identifiers, column names and comments are ignored; admin screens are not listed.
 */
const FILES = [
  "lib/pickup/pickupPushNotifications.ts",
  "mobile/lib/pickup/pickupPushNotifications.ts",
  "lib/pickup/autoSettleSession.ts",
  "lib/pickup/ensureTierSessionForRun.ts",
  "app/api/sessions/host-scores/route.ts",
  "app/pickup/page.tsx",
  "app/pickup/PickupHowItWorks.tsx",
  "app/rules/page.tsx",
  "app/run/[eventId]/RunClient.tsx",
  "lib/guidancePlans.ts",
  "lib/pickup/notifyFollowersOfHostRun.ts",
  "lib/alerts/alertRules.ts",
  "lib/push/pushPolicy.ts",
];
const WORD = /(?<![A-Za-z_])(tiers?|waves?)(?![A-Za-z_])/i;
const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function playerText(path: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    if (/console\./.test(line)) continue;
    for (const m of line.match(LITERAL) ?? []) if (/\s/.test(m) && !m.includes("_") && !/^["'`][a-z ,.:]*,[a-z_,]+["'`]$/.test(m)) out.push(m);
    const jsx = line.match(/>([^<>{}]+)</g);
    if (jsx) out.push(...jsx);
  }
  return out;
}

describe("player-facing copy has no tier or wave wording", () => {
  for (const file of FILES) {
    it(file, () => {
      const hits = playerText(file).filter((s) => WORD.test(s));
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }
  it("the still-open push says only what the player needs", () => {
    const s = readFileSync("lib/pickup/pickupPushNotifications.ts", "utf8");
    expect(s).toContain("Your spot for ${title} is still open. Tap to join.");
    expect(s).not.toMatch(/Tier \d|tierLabel/);
  });
});
