import { describe, expect, it } from "vitest";
import { playerMayParticipateInPublicPickupRun } from "@/lib/pickup/publicRunParticipation";

describe("playerMayParticipateInPublicPickupRun", () => {
  it("requires approval", () => {
    expect(
      playerMayParticipateInPublicPickupRun({
        approved: false,
        runType: "public",
        hubRegion: "CT",
        runServiceRegion: "CT",
        explicitRunAccess: true,
      }),
    ).toBe(false);
  });

  it("allows explicit run access for approved public runs", () => {
    expect(
      playerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "CT",
        runServiceRegion: "NJ",
        nearestVenue: "Sofive Brooklyn",
        explicitRunAccess: true,
      }),
    ).toBe(true);
  });

  it("matches hub tab to run service region", () => {
    expect(
      playerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "CT",
        runServiceRegion: "CT",
        nearestVenue: "Sofive Brooklyn",
      }),
    ).toBe(true);
  });

  it("matches profile nearest venue to run region", () => {
    expect(
      playerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "NY",
        runServiceRegion: "NJ",
        nearestVenue: "Sofive Meadowlands",
      }),
    ).toBe(true);
  });
});
