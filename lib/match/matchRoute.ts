import { NextResponse } from "next/server";
import { MatchError } from "@/lib/match/matchService";

export function matchErrorResponse(route: string, e: unknown) {
  if (e instanceof MatchError) {
    return NextResponse.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status });
  }
  console.error(`[api/match/${route}]`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

export const NO_STORE = { "Cache-Control": "private, no-store" };
