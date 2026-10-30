import { describe, expect, it } from "vitest";

import { ALERT_DEFAULT_ON } from "@/lib/alerts/alertRules";
import { ALERT_OPTIONS, VISIBLE_ALERT_OPTIONS, alertEnabled } from "../mobile/lib/fields/alerts";
import { readFileSync } from "node:fs";

describe("field alert switches", () => {
  it("the server defaults match the defaults the app shows", () => {
    for (const o of ALERT_OPTIONS) expect(ALERT_DEFAULT_ON[o.type], o.type).toBe(o.defaultOn);
  });
  it("weekly roundup is hidden because nothing sends it yet; the four that send are shown", () => {
    expect(VISIBLE_ALERT_OPTIONS.map((o) => o.type)).toEqual(["slot_opens", "request_updates", "new_games", "changes_cancellations"]);
    expect(alertEnabled([], "weekly_roundup")).toBe(false);
  });
  it("tapping each new alert opens the right screen", () => {
    const hook = readFileSync("mobile/hooks/usePushRegistration.ts", "utf8");
    for (const kind of ["fields_new_game", "fields_slot_open", "fields_change"]) expect(hook, kind).toContain(`"${kind}"`);
    expect(hook).toContain('pathname: "/field/[id]"');
    expect(hook).toContain('pathname: "/session/[id]"');
  });
});
