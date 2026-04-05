import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) {
    return NextResponse.json(
      { accepted: false, currentVersion: CURRENT_WAIVER_VERSION, authenticated: false },
      { status: 200 }
    );
  }

  const anon = createClient(supabaseUrl, anonKey);
  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) {
    return NextResponse.json(
      { accepted: false, currentVersion: CURRENT_WAIVER_VERSION, authenticated: false },
      { status: 200 }
    );
  }

  const accepted = await userHasAcceptedCurrentWaiver(u.user.id);
  return NextResponse.json({
    accepted,
    currentVersion: CURRENT_WAIVER_VERSION,
    authenticated: true,
  });
}
