import { NextResponse } from "next/server";
import { commit_rsvp } from "@/lib/pickup/core";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const event_id = String(body.event_id || "");
    const ig_handle = String(body.ig_handle || "");
    const name = body.name ? String(body.name) : null;
    const choice = body.choice as "A" | "B";
    const role = body.role as "field" | "goalie";

    if (!event_id) return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
    if (!ig_handle) return NextResponse.json({ error: "Missing ig_handle" }, { status: 400 });
    if (choice !== "A" && choice !== "B") return NextResponse.json({ error: "Invalid choice" }, { status: 400 });
    if (role !== "field" && role !== "goalie") return NextResponse.json({ error: "Invalid role" }, { status: 400 });

    const result = await commit_rsvp({ event_id, ig_handle, name, choice, role });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}