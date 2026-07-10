import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { fetchAdminUserIds } from "@/lib/push/adminUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;

    // Supabase webhook sends { type, table, record, old_record, schema }
    const record = body?.record as Record<string, unknown> | null;
    if (!record) return NextResponse.json({ ok: true });

    const firstName = String(record.first_name ?? "").trim();
    const lastName = String(record.last_name ?? "").trim();
    const username = String(record.username ?? "").trim();
    const name = [firstName, lastName].filter(Boolean).join(" ") || username || "New player";

    const admin = getSupabaseAdmin();
    const adminResult = await fetchAdminUserIds(admin);

    if ("ids" in adminResult && adminResult.ids.length > 0) {
      await sendPushToUsers(admin, adminResult.ids, {
        title: "New Member 🎉",
        body: `${name} just joined CT Pickup.`,
        data: { screen: "admin/members" },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[notify-new-member] error", e);
    return NextResponse.json({ ok: true });
  }
}
