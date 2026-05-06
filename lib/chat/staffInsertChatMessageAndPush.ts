import type { SupabaseClient } from "@supabase/supabase-js";
import { truncatePushBody } from "@/lib/push/truncatePushBody";
import { sendPushToAll, sendPushToUsers, type SendPushResult } from "@/lib/push/sendExpoPush";

export type StaffPushRoom = {
  id: string;
  slug: string;
  title: string;
  room_type: string | null;
};

export async function staffInsertChatMessageAndPush(
  admin: SupabaseClient,
  staffUserId: string,
  room: StaffPushRoom,
  message: string,
): Promise<{ insertError: string | null; push: SendPushResult | null }> {
  const ins = await admin.from("chat_messages").insert({
    room_id: room.id,
    user_id: staffUserId,
    body: message,
  });
  if (ins.error) return { insertError: ins.error.message, push: null };

  const isGroup = room.room_type === "group";
  let userIds: string[] = [];

  if (isGroup) {
    const mem = await admin.from("chat_room_members").select("user_id").eq("room_id", room.id);
    if (mem.error) return { insertError: mem.error.message, push: null };
    userIds = (mem.data ?? [])
      .map((r) => (r as { user_id?: string }).user_id)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
  }

  const title = room.title || "CT Pickup";
  const bodyText = truncatePushBody(message);
  const pushPayload = {
    title,
    body: bodyText,
    data: {
      kind: "announcement",
      room_slug: room.slug,
      room_id: room.id,
      room_type: room.room_type,
    },
  };

  const push = isGroup ? await sendPushToUsers(admin, userIds, pushPayload) : await sendPushToAll(admin, pushPayload);
  return { insertError: null, push };
}
