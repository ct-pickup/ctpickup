import { describe, expect, it } from "vitest";
import {
  countAcceptedPickupRsvps,
  isReservedRsvpStatus,
  PICKUP_CAPACITY_STATUSES,
} from "@/lib/pickup/waitlist";

describe("pickup RSVP capacity", () => {
  it("reserves capacity only for confirmed and pending_payment", () => {
    expect(PICKUP_CAPACITY_STATUSES).toEqual(["confirmed", "pending_payment"]);
    expect(isReservedRsvpStatus("confirmed")).toBe(true);
    expect(isReservedRsvpStatus("pending_payment")).toBe(true);
    expect(isReservedRsvpStatus("waitlist")).toBe(false);
    expect(isReservedRsvpStatus("pending_confirm")).toBe(false);
    expect(isReservedRsvpStatus("standby")).toBe(false);
  });

  it("counts accepted RSVPs via Supabase head count", async () => {
    const chain = {
      eq: () => chain,
      in: () => chain,
      select: () => chain,
    };
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ count: 7, error: null }),
          }),
        }),
      }),
    };
    const n = await countAcceptedPickupRsvps(admin as never, "run-1");
    expect(n).toBe(7);
  });
});
