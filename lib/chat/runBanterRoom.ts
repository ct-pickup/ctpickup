import { isPublicPickupRunType } from "@/lib/pickup/pickupRunType";
import { resolveRunVenueDestination } from "@/lib/venueDistance";
import type { SupabaseClient } from "@supabase/supabase-js";

const RUN_BANTER = "run_banter" as const;

export type PickupRunBanterMeta = {
  title?: string | null;
  location_private?: string | null;
  service_region?: string | null;
  run_type?: string | null;
  start_at?: string | null;
};

/** America/New_York short date for run chat room title (e.g. "May 23"). */
export function formatRunChatTitleEt(isoStartAt: string): string {
  const d = new Date(isoStartAt);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function pickupRunVenueDisplayName(run: PickupRunBanterMeta): string {
  const dest = resolveRunVenueDestination({
    locationPrivate: run.location_private,
    serviceRegion: run.service_region,
  });
  if (dest?.venue) return dest.venue;

  const loc = String(run.location_private || "").trim();
  if (loc) {
    const first = loc.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  }

  const title = String(run.title || "").trim();
  return title || "Pickup run";
}

export function buildRunBanterRoomTitle(venueName: string, isoStartAt: string): string {
  const datePart = formatRunChatTitleEt(isoStartAt);
  const venue = String(venueName || "").trim() || "Pickup run";
  return datePart ? `${venue} · ${datePart}` : venue;
}

export function buildRunBanterRoomDescription(runType: unknown): string {
  return isPublicPickupRunType(runType) ? "Public" : "Select";
}

export function runBanterSlugForRunId(runId: string): string {
  return `rb${String(runId).replace(/-/g, "")}`;
}

export async function findRunBanterRoomId(admin: SupabaseClient, runId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("chat_rooms")
    .select("id")
    .eq("run_id", runId)
    .eq("room_type", RUN_BANTER)
    .maybeSingle();
  if (error || !data?.id) return null;
  return String(data.id);
}

export async function findRunBanterRoom(
  admin: SupabaseClient,
  runId: string,
): Promise<{ id: string; created_by: string | null } | null> {
  const { data, error } = await admin
    .from("chat_rooms")
    .select("id,created_by")
    .eq("run_id", runId)
    .eq("room_type", RUN_BANTER)
    .maybeSingle();
  if (error || !data?.id) return null;
  return {
    id: String(data.id),
    created_by: (data as { created_by?: string | null }).created_by ?? null,
  };
}

export async function addUserToRunBanterRoom(admin: SupabaseClient, runId: string, userId: string): Promise<void> {
  const roomId = await findRunBanterRoomId(admin, runId);
  if (!roomId) return;
  await admin
    .from("chat_room_members")
    .upsert({ room_id: roomId, user_id: userId }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
}

export async function removeUserFromRunBanterRoom(admin: SupabaseClient, runId: string, userId: string): Promise<void> {
  const roomId = await findRunBanterRoomId(admin, runId);
  if (!roomId) return;
  await admin.from("chat_room_members").delete().eq("room_id", roomId).eq("user_id", userId);
}

async function syncRunBanterRoomLabels(
  admin: SupabaseClient,
  roomId: string,
  run: PickupRunBanterMeta,
  slotStartAtIso: string,
): Promise<void> {
  const startIso = slotStartAtIso || String(run.start_at || "");
  const venue = pickupRunVenueDisplayName(run);
  const title = buildRunBanterRoomTitle(venue, startIso);
  const description = buildRunBanterRoomDescription(run.run_type);

  const up = await admin.from("chat_rooms").update({ title, description }).eq("id", roomId);
  if (up.error) console.error("[runBanterRoom] update chat_rooms labels:", up.error);
}

export async function ensureRunBanterRoomAndMembers(
  admin: SupabaseClient,
  runId: string,
  slotStartAtIso: string,
): Promise<void> {
  const runRes = await admin
    .from("pickup_runs")
    .select("title,location_private,service_region,run_type,start_at")
    .eq("id", runId)
    .maybeSingle();
  const run = (runRes.data ?? {}) as PickupRunBanterMeta;

  const existing = await findRunBanterRoomId(admin, runId);
  const startMs = Date.parse(slotStartAtIso);
  const autoCloseIso = Number.isFinite(startMs)
    ? new Date(startMs + 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const title = buildRunBanterRoomTitle(pickupRunVenueDisplayName(run), slotStartAtIso);
  const description = buildRunBanterRoomDescription(run.run_type);
  const slug = runBanterSlugForRunId(runId);

  let roomId = existing;
  if (!roomId) {
    const ins = await admin
      .from("chat_rooms")
      .insert({
        slug,
        title,
        description,
        room_type: RUN_BANTER,
        run_id: runId,
        auto_close_at: autoCloseIso,
        is_active: true,
        announcements_only: false,
      })
      .select("id")
      .single();
    if (ins.error) {
      const msg = ins.error.message || "";
      if (/duplicate key|unique constraint|23505/i.test(msg)) {
        roomId = await findRunBanterRoomId(admin, runId);
      } else {
        console.error("[runBanterRoom] insert chat_rooms:", ins.error);
        return;
      }
    } else {
      roomId = ins.data?.id ? String(ins.data.id) : null;
    }
  } else {
    await syncRunBanterRoomLabels(admin, roomId, run, slotStartAtIso);
  }

  if (!roomId) return;

  const rsvp = await admin.from("pickup_run_rsvps").select("user_id").eq("run_id", runId).eq("status", "confirmed");
  if (rsvp.error || !rsvp.data?.length) return;

  for (const row of rsvp.data as { user_id: string }[]) {
    const uid = row.user_id;
    if (!uid) continue;
    const mem = await admin
      .from("chat_room_members")
      .upsert({ room_id: roomId, user_id: uid }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
    if (mem.error) console.error("[runBanterRoom] member upsert:", mem.error);
  }
}
