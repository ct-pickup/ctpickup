import { NextResponse } from "next/server";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";
import { getSupabaseAnon } from "@/lib/server/runtimeClients";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  if (!token) {
    return NextResponse.json(
      { accepted: false, currentVersion: CURRENT_WAIVER_VERSION, authenticated: false },
      { status: 200 }
    );
  }

  const anon = getSupabaseAnon();
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
