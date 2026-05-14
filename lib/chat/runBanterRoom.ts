import type { SupabaseClient } from "@supabase/supabase-js";

const RUN_BANTER = "run_banter" as const;

/** America/New_York calendar date for run chat room title. */
export function formatRunChatTitleEt(isoStartAt: string): string {
  const d = new Date(isoStartAt);
  if (!Number.isFinite(d.getTime())) return "Run";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
  }).format(d);
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

export async function ensureRunBanterRoomAndMembers(
  admin: SupabaseClient,
  runId: string,
  slotStartAtIso: string,
): Promise<void> {
  const existing = await findRunBanterRoomId(admin, runId);
  const startMs = Date.parse(slotStartAtIso);
  const autoCloseIso = Number.isFinite(startMs)
    ? new Date(startMs + 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const title = `Run Chat 🏃 · ${formatRunChatTitleEt(slotStartAtIso)}`;
  const slug = runBanterSlugForRunId(runId);

  let roomId = existing;
  if (!roomId) {
    const ins = await admin
      .from("chat_rooms")
      .insert({
        slug,
        title,
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
