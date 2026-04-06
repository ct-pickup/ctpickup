/**
 * Staff-facing labels for internal sync / publish enums.
 * Values here are for display only — API and DB still use canonical strings.
 */

function titleCaseWords(s: string): string {
  return s
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** admin_surface_health.sync_state, publication delivery sync_state */
export function labelPublishSyncState(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "synced") return "Delivered";
  if (s === "pending") return "Waiting";
  if (s === "failed") return "Failed";
  if (s === "n/a" || s === "na") return "Off";
  if (!s) return "—";
  return titleCaseWords(String(raw));
}

/** admin_sync_jobs.status */
export function labelSyncJobStatus(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "succeeded") return "Done";
  if (s === "failed") return "Failed";
  if (s === "pending") return "Waiting";
  if (!s) return "—";
  return titleCaseWords(String(raw));
}

/** admin_sync_jobs.job_type */
export function labelSyncJobType(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "revalidate") return "Page refresh";
  if (!s) return "—";
  return titleCaseWords(String(raw));
}

/** admin_publication_deliveries.channel */
export function labelPublicationChannel(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "site_status") return "Site-wide status";
  if (s === "pickup_global") return "Pickup (everyone)";
  if (s === "pickup_run") return "Pickup (one run)";
  if (s === "tournament_active") return "Live tournament";
  if (!s) return "—";
  return titleCaseWords(String(raw));
}

/** Operator “where this appears” row state */
export function labelOperatorSurfaceState(raw: string | null | undefined): string {
  return labelPublishSyncState(raw);
}

/** pickup_runs.status in staff tables */
export function labelPickupRunStatus(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "planning") return "Planning";
  if (s === "likely_on") return "Likely on";
  if (s === "active") return "Active";
  if (s === "canceled" || s === "cancelled") return "Canceled";
  if (s === "draft") return "Draft";
  if (!s) return "—";
  return titleCaseWords(String(raw));
}
