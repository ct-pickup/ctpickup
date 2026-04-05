import type { CtPickupSmsKind } from "@/lib/twilio/types";

/**
 * Example templates — replace placeholders at send time. Keep under 320 chars when possible.
 * Integration: load run time / location from DB and pass into sendSms({ body: ... }).
 */

export type TemplateVars = {
  runTimeLabel?: string;
  locationShort?: string;
  firstName?: string;
  tournamentName?: string;
};

export function buildCtPickupSmsBody(kind: CtPickupSmsKind, vars: TemplateVars = {}): string {
  const t = vars.runTimeLabel ?? "[time]";
  const loc = vars.locationShort ?? "our spot";
  const name = vars.firstName ? ` ${vars.firstName}` : "";
  const tourney = vars.tournamentName ?? "the tournament";

  switch (kind) {
    case "run_invite":
      return `CT Pickup: Hi${name} — you're invited to pickup ${t} at ${loc}. Open the app or reply YES to RSVP if this run uses SMS RSVP.`;
    case "confirmation":
      return `CT Pickup: You're confirmed for ${t} at ${loc}. Bring water + a light/dark. See you there.`;
    case "reminder":
      return `CT Pickup reminder: ${t} at ${loc}. Check the app for any last-minute updates.`;
    case "spot_opened":
      return `CT Pickup: A spot opened for ${t} at ${loc}. Reply YES to claim it (first YES may win — final confirm in app).`;
    case "tournament_alert":
      return `CT Pickup: ${tourney} update — check the app for bracket or check-in details.`;
    default:
      return `CT Pickup: You have an update. Open the app for details.`;
  }
}
