import { describe, expect, it, vi } from "vitest";

import { goBack } from "../mobile/lib/goBack";
import { gatesPassed, recheckMayBlock } from "../mobile/lib/tabGates";

function router(canGoBack: boolean) {
  return { back: vi.fn(), replace: vi.fn(), canGoBack: () => canGoBack };
}

describe("goBack", () => {
  it("goes one step back when there is history (the screen was opened from a card)", () => {
    const r = router(true);
    goBack(r, "/(tabs)/leaderboards");
    expect(r.back).toHaveBeenCalledTimes(1);
    expect(r.replace).not.toHaveBeenCalled();
  });
  it("falls back to the screen it belongs to, never Home, when opened with no history (a push or a link)", () => {
    const r = router(false);
    goBack(r, "/(tabs)/leaderboards");
    expect(r.back).not.toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith("/(tabs)/leaderboards");
    const f = router(false);
    goBack(f, "/(tabs)/sessions?view=fields");
    expect(f.replace).toHaveBeenCalledWith("/(tabs)/sessions?view=fields");
  });
});

describe("tab gates (why back from a card used to land on Home)", () => {
  it("never lets a re-check cover the screen once the gates were passed, so the tabs stay mounted", () => {
    expect(recheckMayBlock(true)).toBe(false);
  });
  it("still blocks the first check, and a check after a gate was not passed", () => {
    expect(recheckMayBlock(false)).toBe(true);
  });
  it("counts the gates as passed only when onboarding is done and no season intro is pending", () => {
    expect(gatesPassed({ onboardingDone: true, seasonEnabled: false, seasonIntroNeeded: true })).toBe(true);
    expect(gatesPassed({ onboardingDone: true, seasonEnabled: true, seasonIntroNeeded: false })).toBe(true);
    expect(gatesPassed({ onboardingDone: true, seasonEnabled: true, seasonIntroNeeded: true })).toBe(false);
    expect(gatesPassed({ onboardingDone: false, seasonEnabled: false, seasonIntroNeeded: false })).toBe(false);
  });
});
