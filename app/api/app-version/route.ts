import { NextResponse } from "next/server";

import { resolveMinAppVersion } from "@/lib/api/appMinVersion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel env, no redeploy needed:
// FORCE_UPDATE_ENABLED=true turns on the 1.4.0 forced update. Off by default.
// MIN_APP_VERSION=x.y.z is the floor used while the flag is off (default 1.1.0).
export async function GET() {
  return NextResponse.json({
    min_version: resolveMinAppVersion({
      MIN_APP_VERSION: process.env.MIN_APP_VERSION,
      FORCE_UPDATE_ENABLED: process.env.FORCE_UPDATE_ENABLED,
    }),
  });
}
