import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/admin/guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  try {
    const body = await req.json();
    const event_id = String(body.event_id || "");
    const wave = String(body.wave || "1A"); // 1A|1B|2

    if (!event_id) return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
    if (!["1A", "1B", "2"].includes(wave)) {
      return NextResponse.json({ error: "wave must be 1A, 1B, or 2" }, { status: 400 });
    }

    const tierTarget = wave; // tier == wave for 1A/1B, tier == 2 for wave 2

    const supabase = supabaseService();

    // Pull active players in that tier
    const { data: players, error: pErr } = await supabase
      .from("players")
      .select("id, ig_handle")
      .eq("tier", tierTarget)
      .eq("status", "active");

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

    if (!players || players.length === 0) {
      return NextResponse.json({ handles: [], message: "No players found for that tier." });
    }

    // Insert invite rows (ignore conflicts)
    const rows = players.map((p) => ({
      event_id,
      player_id: p.id,
      wave,
    }));

    const { error: iErr } = await supabase.from("event_invites").upsert(rows, {
      onConflict: "event_id,player_id,wave",
      ignoreDuplicates: true as any,
    });

    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

    const handles = players.map((p) => p.ig_handle);

    return NextResponse.json({
      wave,
      count: handles.length,
      handles,
      dm_template: `Reply RUN for a chance to get in.\n\nGot you. Today’s options:\nA) [A TIME]\nB) [B TIME]\nRSVP here: [RUN LINK]\nUpdates: [STATUS LINK]`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}