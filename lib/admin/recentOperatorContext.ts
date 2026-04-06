import type { SupabaseClient } from "@supabase/supabase-js";

export type RecentUpdateLine = {
  kind: "pickup_post" | "status_row" | "pickup_run" | "tournament";
  label: string;
  at: string | null;
  detail: string;
};

function fmt(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Best-effort recent activity from existing timestamps (no audit table).
 */
export async function loadRecentOperatorContext(supabase: SupabaseClient): Promise<RecentUpdateLine[]> {
  const lines: RecentUpdateLine[] = [];

  const [postsRes, runsRes, tourRes, statusRes] = await Promise.all([
    supabase
      .from("pickup_run_updates")
      .select("id,run_id,message,created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("pickup_runs")
      .select("id,title,status,is_current,updated_at")
      .neq("status", "canceled")
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase.from("tournaments").select("id,title,is_active,created_at").order("created_at", { ascending: false }).limit(4),
    supabase.from("status_updates").select("*").eq("id", 1).maybeSingle(),
  ]);

  for (const p of postsRes.data || []) {
    const scope = p.run_id ? `One run (${String(p.run_id).slice(0, 8)}…)` : "All players";
    lines.push({
      kind: "pickup_post",
      label: "Pickup post",
      at: fmt(p.created_at as string),
      detail: `${scope}: ${String(p.message || "").slice(0, 120)}${String(p.message || "").length > 120 ? "…" : ""}`,
    });
  }

  const statusRow = statusRes.data as Record<string, unknown> | null;
  const statusAt = (statusRow?.updated_at as string | undefined) || (statusRow?.created_at as string | undefined);
  if (statusRow && statusAt) {
    lines.push({
      kind: "status_row",
      label: "Site-wide status",
      at: fmt(statusAt),
      detail: statusRow.announcement
        ? `Announcement: ${String(statusRow.announcement).slice(0, 100)}${String(statusRow.announcement).length > 100 ? "…" : ""}`
        : "Announcement empty",
    });
  } else if (statusRow) {
    lines.push({
      kind: "status_row",
      label: "Site-wide status",
      at: null,
      detail: statusRow.announcement
        ? `Announcement: ${String(statusRow.announcement).slice(0, 100)}${String(statusRow.announcement).length > 100 ? "…" : ""}`
        : "Announcement empty",
    });
  }

  for (const r of runsRes.data || []) {
    lines.push({
      kind: "pickup_run",
      label: r.is_current ? "Pickup run (on hub)" : "Pickup run",
      at: fmt(r.updated_at as string),
      detail: `${r.title || r.id} · ${r.status}${r.is_current ? " · promoted" : ""}`,
    });
  }

  for (const t of tourRes.data || []) {
    lines.push({
      kind: "tournament",
      label: t.is_active ? "Tournament (live)" : "Tournament",
      at: fmt((t as { created_at?: string }).created_at),
      detail: String(t.title || t.id),
    });
  }

  lines.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return tb - ta;
  });

  return lines.slice(0, 12);
}
