import { NextResponse } from "next/server";
import { adminDeleteChatRoomById } from "@/lib/admin/chatRoomDelete";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

/**
 * POST fallback for environments that mishandle DELETE (or older deploys without DELETE on the parent route).
 * Same auth and behavior as DELETE /api/admin/chat/rooms/[roomId].
 */
export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { roomId } = await ctx.params;
  const result = await adminDeleteChatRoomById(roomId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, deleted: result.deleted });
}
