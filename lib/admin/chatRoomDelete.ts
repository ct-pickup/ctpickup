import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

const PROTECTED_SLUGS = new Set(["announcements", "team"]);

export type AdminDeleteChatRoomResult =
  | { ok: true; deleted: { id: string; slug: string; title: string } }
  | { ok: false; status: number; error: string };

/**
 * Deletes a chat room and dependent rows (messages/mutes) via FK cascade.
 * Blocks deletion of slug `announcements` and `team`.
 */
export async function adminDeleteChatRoomById(roomId: string): Promise<AdminDeleteChatRoomResult> {
  const id = String(roomId || "").trim();
  if (!id) return { ok: false, status: 400, error: "Missing roomId" };

  const admin = getSupabaseAdmin();

  const { data: room, error: lookupErr } = await admin
    .from("chat_rooms")
    .select("id,slug,title")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) return { ok: false, status: 500, error: lookupErr.message };
  if (!room) return { ok: false, status: 404, error: "Room not found" };

  if (PROTECTED_SLUGS.has(String(room.slug))) {
    return { ok: false, status: 400, error: "Cannot delete a system room" };
  }

  const { error: delErr } = await admin.from("chat_rooms").delete().eq("id", id);
  if (delErr) return { ok: false, status: 500, error: delErr.message };

  return { ok: true, deleted: { id: room.id, slug: room.slug, title: room.title } };
}
