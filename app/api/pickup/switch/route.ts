import { NextResponse } from "next/server";
import { switch_to_locked } from "@/lib/pickup/core";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const event_id = String(body.event_id || "");
    const ig_handle = String(body.ig_handle || "");

    if (!event_id) return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
    if (!ig_handle) return NextResponse.json({ error: "Missing ig_handle" }, { status: 400 });

    const result = await switch_to_locked({ event_id, ig_handle });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}