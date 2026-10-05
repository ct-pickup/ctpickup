import { describe, expect, it } from "vitest";

import { isMuteActive, muteStatusText, muteUntilFor } from "../mobile/lib/chatMute";

const NOW = Date.parse("2026-10-09T12:00:00Z");

describe("muteUntilFor", () => {
  it("adds the chosen time", () => {
    expect(muteUntilFor("1h", NOW)).toBe("2026-10-09T13:00:00.000Z");
    expect(muteUntilFor("8h", NOW)).toBe("2026-10-09T20:00:00.000Z");
    expect(muteUntilFor("1w", NOW)).toBe("2026-10-16T12:00:00.000Z");
  });
  it("has no end for until I turn it back on", () => {
    expect(muteUntilFor("forever", NOW)).toBeNull();
  });
});

describe("mute state", () => {
  it("null never expires, past has expired, future is active", () => {
    expect(isMuteActive(null, NOW)).toBe(true);
    expect(isMuteActive("2026-10-09T11:59:00Z", NOW)).toBe(false);
    expect(isMuteActive("2026-10-09T12:01:00Z", NOW)).toBe(true);
  });
  it("words the status in Eastern time", () => {
    expect(muteStatusText("2026-10-09T19:00:00Z")).toBe("Muted until Fri, Oct 9, 3:00 PM");
    expect(muteStatusText(null)).toBe("Muted until you turn it back on");
  });
});
