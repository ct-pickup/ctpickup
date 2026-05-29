import { describe, expect, it } from "vitest";
import {
  pickupPublicPayloadMatchesRunId,
  pickupPublicPayloadRunId,
} from "../../mobile/lib/pickup/pickupPublicPayload";

describe("pickupPublicPayloadRunId", () => {
  it("reads run id from public payload", () => {
    expect(
      pickupPublicPayloadRunId({
        status: "planning",
        run: { id: "abc-123", status: "planning" },
      }),
    ).toBe("abc-123");
  });

  it("returns null when run is missing", () => {
    expect(pickupPublicPayloadMatchesRunId({ status: "inactive", run: null }, "abc-123")).toBe(false);
  });

  it("matches expected run id", () => {
    expect(
      pickupPublicPayloadMatchesRunId(
        { run: { id: "abc-123", status: "planning" } },
        "abc-123",
      ),
    ).toBe(true);
  });
});
