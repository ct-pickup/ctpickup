import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SURFACE_PICKUP_GLOBAL,
  SURFACE_TOURNAMENT_HUB,
  surfaceKeyPickupRun,
  surfaceKeyTournament,
} from "@/lib/admin/surfaceHealth";

export type OperatorSurfaceState = "synced" | "pending" | "failed" | "n/a";

export type WhereSurfaceRow = {
  key: string;
  label: string;
  path: string;
  note: string;
  state: OperatorSurfaceState;
  lastError: string | null;
  failedDeliveryId: string | null;
};

export type PickupOperatorBundle = {
  tablesMissing: boolean;
  latestRunPost: { message: string; created_at: string } | null;
  surfaceRun: {
    sync_state: string;
    last_success_at: string | null;
    last_error: string | null;
    updated_at: string | null;
  } | null;
  surfaceGlobal: {
    sync_state: string;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
  failedDeliveries: { id: string; last_error: string | null; channel: string }[];
  whereRows: WhereSurfaceRow[];
};

export type TournamentOperatorBundle = {
  tablesMissing: boolean;
  staffAnnouncement: string | null;
  staffAnnouncementAt: string | null;
  surfaceHub: {
    sync_state: string;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
  surfaceT: {
    sync_state: string;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
  failedDeliveries: { id: string; last_error: string | null; channel: string }[];
  whereRows: WhereSurfaceRow[];
};

function isMissingAdminTableError(err: { message?: string } | null) {
  if (!err?.message) return false;
  return /admin_|schema cache|does not exist|could not find the table/i.test(err.message);
}

function toneFromSurface(s: { sync_state?: string } | null | undefined): OperatorSurfaceState {
  const st = s?.sync_state;
  if (st === "failed") return "failed";
  if (st === "pending") return "pending";
  if (st === "synced") return "synced";
  return "n/a";
}

export async function getPickupOperatorContext(
  admin: SupabaseClient,
  runId: string,
  meta: { is_current?: boolean | null; status?: string | null },
): Promise<PickupOperatorBundle> {
  const skRun = surfaceKeyPickupRun(runId);

  const [latestPostRes, surfRunRes, surfGlobalRes, failRunRes, failGlobalRes] = await Promise.all([
    admin
      .from("pickup_run_updates")
      .select("message, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("admin_surface_health").select("*").eq("surface_key", skRun).maybeSingle(),
    admin.from("admin_surface_health").select("*").eq("surface_key", SURFACE_PICKUP_GLOBAL).maybeSingle(),
    admin
      .from("admin_publication_deliveries")
      .select("id, last_error, channel")
      .eq("sync_state", "failed")
      .eq("channel", "pickup_run")
      .eq("entity_id", runId),
    admin
      .from("admin_publication_deliveries")
      .select("id, last_error, channel")
      .eq("sync_state", "failed")
      .eq("channel", "pickup_global")
      .is("entity_id", null),
  ]);

  const tablesMissing =
    isMissingAdminTableError(surfRunRes.error) ||
    isMissingAdminTableError(failRunRes.error) ||
    isMissingAdminTableError(latestPostRes.error);

  const surfaceRun = surfRunRes.data
    ? {
        sync_state: String(surfRunRes.data.sync_state || "n/a"),
        last_success_at: (surfRunRes.data.last_success_at as string) ?? null,
        last_error: (surfRunRes.data.last_error as string) ?? null,
        updated_at: (surfRunRes.data.updated_at as string) ?? null,
      }
    : null;

  const surfaceGlobal = surfGlobalRes.data
    ? {
        sync_state: String(surfGlobalRes.data.sync_state || "n/a"),
        last_success_at: (surfGlobalRes.data.last_success_at as string) ?? null,
        last_error: (surfGlobalRes.data.last_error as string) ?? null,
      }
    : null;

  const failedDeliveries = [
    ...((failRunRes.data || []) as { id: string; last_error: string | null; channel: string }[]),
    ...((failGlobalRes.data || []) as { id: string; last_error: string | null; channel: string }[]),
  ];

  const failedForRun = failedDeliveries.find((d) => d.channel === "pickup_run");
  const failedGlobal = failedDeliveries.find((d) => d.channel === "pickup_global");

  const hubState: OperatorSurfaceState = meta.is_current ? toneFromSurface(surfRunRes.data) : "n/a";
  const hubNote = meta.is_current
    ? "This run is the one on the pickup hub."
    : "The hub shows whichever run is promoted — not this one.";

  const feedState = toneFromSurface(surfRunRes.data);
  const feedNote = "Run-scoped posts from unified Publish appear in pickup feeds and status.";

  const whereRows: WhereSurfaceRow[] = [
    {
      key: "hub",
      label: "Pickup hub",
      path: "/pickup",
      note: hubNote,
      state: hubState,
      lastError: meta.is_current ? surfaceRun?.last_error ?? null : null,
      failedDeliveryId: meta.is_current ? failedForRun?.id ?? null : null,
    },
    {
      key: "status_pickup",
      label: "Pickup status",
      path: "/status/pickup",
      note: feedNote,
      state: feedState,
      lastError: surfaceRun?.last_error ?? null,
      failedDeliveryId: failedForRun?.id ?? null,
    },
    {
      key: "global_posts",
      label: "All-player pickup posts",
      path: "/pickup · /status/pickup",
      note: "Message for all pickup players, not tied to one run.",
      state: toneFromSurface(surfGlobalRes.data),
      lastError: surfaceGlobal?.last_error ?? null,
      failedDeliveryId: failedGlobal?.id ?? null,
    },
  ];

  return {
    tablesMissing,
    latestRunPost: latestPostRes.data
      ? {
          message: String((latestPostRes.data as { message?: string }).message || ""),
          created_at: String((latestPostRes.data as { created_at?: string }).created_at || ""),
        }
      : null,
    surfaceRun,
    surfaceGlobal,
    failedDeliveries,
    whereRows,
  };
}

export async function getTournamentOperatorContext(
  admin: SupabaseClient,
  tournament: {
    id: string;
    title?: string | null;
    staff_announcement?: string | null;
    staff_announcement_at?: string | null;
  } | null,
): Promise<TournamentOperatorBundle> {
  if (!tournament) {
    return {
      tablesMissing: false,
      staffAnnouncement: null,
      staffAnnouncementAt: null,
      surfaceHub: null,
      surfaceT: null,
      failedDeliveries: [],
      whereRows: [],
    };
  }

  const tid = tournament.id;
  const skT = surfaceKeyTournament(tid);

  const [surfHubRes, surfTRes, failDelRes] = await Promise.all([
    admin.from("admin_surface_health").select("*").eq("surface_key", SURFACE_TOURNAMENT_HUB).maybeSingle(),
    admin.from("admin_surface_health").select("*").eq("surface_key", skT).maybeSingle(),
    admin
      .from("admin_publication_deliveries")
      .select("id, last_error, channel")
      .eq("sync_state", "failed")
      .eq("channel", "tournament_active")
      .eq("entity_id", tid),
  ]);

  const tablesMissing =
    isMissingAdminTableError(surfHubRes.error) ||
    isMissingAdminTableError(failDelRes.error);

  const surfaceHub = surfHubRes.data
    ? {
        sync_state: String(surfHubRes.data.sync_state || "n/a"),
        last_success_at: (surfHubRes.data.last_success_at as string) ?? null,
        last_error: (surfHubRes.data.last_error as string) ?? null,
      }
    : null;

  const surfaceT = surfTRes.data
    ? {
        sync_state: String(surfTRes.data.sync_state || "n/a"),
        last_success_at: (surfTRes.data.last_success_at as string) ?? null,
        last_error: (surfTRes.data.last_error as string) ?? null,
      }
    : null;

  const failedDeliveries = (failDelRes.data || []) as {
    id: string;
    last_error: string | null;
    channel: string;
  }[];

  const failedD = failedDeliveries[0] || null;

  const ann = tournament.staff_announcement?.trim() || null;
  const annAt = tournament.staff_announcement_at || null;

  const whereRows: WhereSurfaceRow[] = [
    {
      key: "t_hub",
      label: "Tournament hub",
      path: "/tournament",
      note: "Whatever tournament is live drives this page.",
      state: toneFromSurface(surfHubRes.data),
      lastError: surfaceHub?.last_error ?? null,
      failedDeliveryId: failedD?.id ?? null,
    },
    {
      key: "t_status",
      label: "Tournament status",
      path: "/status/tournament",
      note: "Shows the announcement when you publish to the live tournament.",
      state: toneFromSurface(surfTRes.data),
      lastError: surfaceT?.last_error ?? null,
      failedDeliveryId: failedD?.id ?? null,
    },
  ];

  return {
    tablesMissing,
    staffAnnouncement: ann,
    staffAnnouncementAt: annAt,
    surfaceHub,
    surfaceT,
    failedDeliveries,
    whereRows,
  };
}
