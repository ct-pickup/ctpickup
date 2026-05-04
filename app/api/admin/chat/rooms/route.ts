import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const ROOM_TYPES = new Set(["public", "announcement", "group"]);

const ROOM_SELECT =
  "id,slug,title,room_type,is_active,announcements_only,closes_at,created_at,created_by";

function uniqueValidUuids(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    // Loose uuid sanity check; the FK constraint will reject anything truly bogus.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
      out.add(v.toLowerCase());
    }
  }
  return Array.from(out);
}

function uniqueValidTierRanks(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<number>();
  for (const raw of input) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 6) out.add(n);
  }
  return Array.from(out);
}

export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chat_rooms")
    .select(ROOM_SELECT)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rooms: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").trim();
  const title = String(body.title || "").trim();

  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(slug)) {
    return NextResponse.json(
      { error: "slug must be 2-63 chars: letters, numbers, _ or -" },
      { status: 400 },
    );
  }

  const rawType = typeof body.room_type === "string" ? body.room_type.trim().toLowerCase() : "";
  const room_type = rawType && ROOM_TYPES.has(rawType) ? rawType : "public";

  // announcements_only stays in sync with room_type so older surfaces keep working.
  const announcements_only =
    room_type === "announcement"
      ? true
      : body.announcements_only === true
      ? true
      : false;

  const is_active = body.is_active === false ? false : true;
  const closes_at_raw = body.closes_at == null || body.closes_at === "" ? null : String(body.closes_at);
  const closes_at = closes_at_raw ? new Date(closes_at_raw).toISOString() : null;

  const memberUserIds = uniqueValidUuids(body.member_user_ids);
  const memberTierRanks = uniqueValidTierRanks(body.member_tier_ranks);

  const admin = getSupabaseAdmin();
  const { data: room, error: insertErr } = await admin
    .from("chat_rooms")
    .insert({
      slug,
      title,
      room_type,
      is_active,
      announcements_only,
      closes_at,
      created_by: guard.userId,
    })
    .select(ROOM_SELECT)
    .single();

  if (insertErr || !room) {
    return NextResponse.json(
      { error: insertErr?.message || "Failed to create room" },
      { status: 500 },
    );
  }

  let memberCount = 0;
  let memberError: string | null = null;

  if (room_type === "group" && (memberUserIds.length > 0 || memberTierRanks.length > 0)) {
    const userIdSet = new Set<string>(memberUserIds);

    if (memberTierRanks.length > 0) {
      const { data: tieredProfiles, error: tierErr } = await admin
        .from("profiles")
        .select("id")
        .in("tier_rank", memberTierRanks);

      if (tierErr) {
        memberError = tierErr.message;
      } else {
        for (const row of tieredProfiles ?? []) {
          const id = (row as { id?: string }).id;
          if (typeof id === "string" && id) userIdSet.add(id);
        }
      }
    }

    const ids = Array.from(userIdSet);
    if (!memberError && ids.length > 0) {
      const rows = ids.map((user_id) => ({
        room_id: room.id,
        user_id,
        added_by: guard.userId,
      }));
      const { error: memErr, count } = await admin
        .from("chat_room_members")
        .upsert(rows, { onConflict: "room_id,user_id", count: "exact" });

      if (memErr) memberError = memErr.message;
      else memberCount = typeof count === "number" ? count : ids.length;
    }
  }

  return NextResponse.json({
    ok: true,
    room,
    member_count: memberCount,
    ...(memberError ? { member_error: memberError } : {}),
  });
}
