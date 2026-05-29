import { describe, expect, it } from "vitest";
import {
  explainPlayerMayParticipateInPublicPickupRun,
  playerMayParticipateInPublicPickupRun,
} from "@/lib/pickup/publicRunParticipation";

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
    expect(
      explainPlayerMayParticipateInPublicPickupRun({
        approved: false,
        runType: "public",
        hubRegion: "CT",
        runServiceRegion: "CT",
        explicitRunAccess: true,
      }).branch,
    ).toBe("not_approved");
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
    expect(
      explainPlayerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "CT",
        runServiceRegion: "NJ",
        nearestVenue: "Sofive Brooklyn",
        explicitRunAccess: true,
      }).branch,
    ).toBe("explicit_run_access");
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
    expect(
      explainPlayerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "CT",
        runServiceRegion: "CT",
        nearestVenue: "Sofive Brooklyn",
      }).branch,
    ).toBe("hub_tab_match");
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
    expect(
      explainPlayerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "NY",
        runServiceRegion: "NJ",
        nearestVenue: "Sofive Meadowlands",
      }).branch,
    ).toBe("venue_region_match");
  });

  it("denies when no venue, hub, or explicit access", () => {
    expect(
      playerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "NY",
        runServiceRegion: "NJ",
        nearestVenue: "Sofive Brooklyn",
      }),
    ).toBe(false);
    expect(
      explainPlayerMayParticipateInPublicPickupRun({
        approved: true,
        runType: "public",
        hubRegion: "NY",
        runServiceRegion: "NJ",
        nearestVenue: "Sofive Brooklyn",
      }).branch,
    ).toBe("denied");
  });
});
