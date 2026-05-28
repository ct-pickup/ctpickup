import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickMinVersion(): string {
  // Set this in Vercel/production so you can bump the required version without redeploying:
  // MIN_APP_VERSION=1.1.0
  const raw = process.env.MIN_APP_VERSION?.trim();
  return raw && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(raw) ? raw : "1.1.0";
}

export async function GET() {
  return NextResponse.json({ min_version: pickMinVersion() });
}

