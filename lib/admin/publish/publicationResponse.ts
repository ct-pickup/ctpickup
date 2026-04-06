import type { DeliveryRow, PublishTargetsInput } from "@/lib/admin/publish/types";

const CHANNEL_LABEL: Record<DeliveryRow["channel"], string> = {
  site_status: "Site-wide status",
  pickup_global: "Pickup · all players",
  pickup_run: "Pickup · one run",
  tournament_active: "Live tournament",
};

export function effectsFromPublication(result: {
  deliveries: Array<Pick<DeliveryRow, "channel" | "sync_state" | "last_error">>;
}) {
  return result.deliveries.map((d) => ({
    record: CHANNEL_LABEL[d.channel] ?? d.channel,
    detail:
      d.sync_state === "synced"
        ? "Saved successfully."
        : (d.last_error || "Failed — check Sync & status to retry.").trim(),
  }));
}

export function verifyLinksFromTargets(targets: PublishTargetsInput) {
  const v: { label: string; href: string }[] = [];
  if (targets.pickupGlobal || (targets.pickupRunIds && targets.pickupRunIds.length > 0)) {
    v.push({ label: "Pickup status", href: "/status/pickup" });
  }
  if (targets.siteStatus) {
    v.push({ label: "Site-wide status editor", href: "/admin/status" });
  }
  if (targets.tournamentActive) {
    v.push({ label: "Tournament hub", href: "/tournament" });
    v.push({ label: "Tournament status", href: "/status/tournament" });
  }
  v.push({ label: "Pickup hub", href: "/pickup" });
  return v;
}
