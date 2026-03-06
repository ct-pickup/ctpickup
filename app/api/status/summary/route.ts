import { NextResponse } from "next/server";

export type TourneyStatus = "confirmed" | "planning" | "inactive";
export type PickupStatus = "open" | "invite_only" | "inactive";

// EDIT THESE WHEN NEEDED:
const tournamentStatus: TourneyStatus = "planning"; // "planning" | "confirmed" | "inactive"
const pickupStatus: PickupStatus = "inactive"; // keep inactive for now

export async function GET() {
  return NextResponse.json({
    tournamentStatus,
    pickupStatus,
  });
}
