import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/admin/guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  try {
    const body = await req.json();

    const title = String(body.title || "CT Pickup Run");
    const status = String(body.status || "active"); // draft|active
    const time_option_a = String(body.time_option_a || "");
    const time_option_b = String(body.time_option_b || "");
    const location_name = body.location_name ? String(body.location_name) : null;
    const location_address = body.location_address ? String(body.location_address) : null;

    // roster constraints (defaults if omitted)
    const field_min = Number(body.field_min ?? 15);
    const field_max = Number(body.field_max ?? 18);
    const goalie_min = Number(body.goalie_min ?? 2);
    const goalie_max = Number(body.goalie_max ?? 4);

    // lock rule defaults
    const lock_rule = body.lock_rule ?? { yes_1a: 3, yes_1a_1b: 6, tie_break: "higher_1a_else_A" };

    if (!time_option_a || !time_option_b) {
      return NextResponse.json({ error: "Missing time_option_a or time_option_b" }, { status: 400 });
    }
    if (!["draft", "active"].includes(status)) {
      return NextResponse.json({ error: "status must be draft or active" }, { status: 400 });
    }

    const supabase = supabaseService();

    const { data, error } = await supabase
      .from("events")
      .insert({
        type: "pickup",
        title,
        status,
        time_option_a,
        time_option_b,
        location_name,
        location_address,
        field_min,
        field_max,
        goalie_min,
        goalie_max,
        lock_rule,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ event: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}