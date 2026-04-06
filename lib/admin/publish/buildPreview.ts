import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishTargetsInput } from "./types";

export type PreviewBlock = { key: string; title: string; body: string };

export async function buildPublicationPreview(
  admin: SupabaseClient,
  message: string,
  targets: PublishTargetsInput,
): Promise<PreviewBlock[]> {
  const msg = message.trim() || "(empty message)";
  const blocks: PreviewBlock[] = [];

  if (targets.siteStatus) {
    blocks.push({
      key: "site_status",
      title: "Site-wide status card",
      body: `${msg}\n\nShown on /status/pickup and /status/tournament (status_updates row id=1).`,
    });
  }

  if (targets.pickupGlobal) {
    blocks.push({
      key: "pickup_global",
      title: "Pickup · all players",
      body: `${msg}\n\nStored as pickup_run_updates with run_id = null. Surfaces in pickup feeds and /status/pickup.`,
    });
  }

  const runIds = Array.from(new Set((targets.pickupRunIds || []).map((x) => String(x).trim()).filter(Boolean)));
  for (const runId of runIds) {
    const runRes = await admin.from("pickup_runs").select("id,title,status").eq("id", runId).maybeSingle();
    const r = runRes.data;
    const title = r ? `Pickup · ${r.title || runId.slice(0, 8)}` : `Pickup · run ${runId.slice(0, 8)}…`;
    const warn = !r ? "Run not found — publish will fail for this id." : r.status === "canceled" ? "Run canceled — publish will fail." : "";
    blocks.push({
      key: `pickup_run:${runId}`,
      title,
      body: `${msg}\n\n${warn ? `${warn}\n\n` : ""}Stored as pickup_run_updates for this run.`,
    });
  }

  if (targets.tournamentActive) {
    const tRes = await admin.from("tournaments").select("id,title").eq("is_active", true).maybeSingle();
    const t = tRes.data;
    blocks.push({
      key: "tournament_active",
      title: t ? `Tournament · ${t.title}` : "Tournament (active)",
      body: t
        ? `${msg}\n\nWritten to tournaments.staff_announcement for the active row. Shown on /status/tournament when wired.`
        : `${msg}\n\nNo active tournament — publish will record a failed delivery for this target.`,
    });
  }

  return blocks;
}
