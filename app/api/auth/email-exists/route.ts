import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

/**
 * `auth.admin.listUsers` is paginated; the old route only read page 1 and falsely reported
 * "no account" once there were more users than fit on that page.
 */
const LIST_USERS_PAGE_SIZE = 1000;
/** Safety cap so a pathological case cannot loop unbounded. */
const LIST_USERS_MAX_PAGES = 500;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 5;
const rateLimitHits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function isEmailExistsRateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = rateLimitHits.get(ip) ?? [];
  const pruned = prev.filter((t) => now - t < RATE_WINDOW_MS);
  if (pruned.length >= RATE_MAX_PER_WINDOW) {
    rateLimitHits.set(ip, pruned);
    return true;
  }
  pruned.push(now);
  rateLimitHits.set(ip, pruned);
  return false;
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (isEmailExistsRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const admin = getSupabaseAdmin({
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ exists: false, error: "invalid_email" }, { status: 400 });
    }

    // Fast path: signup/login mirror auth email onto `profiles` (see migrations).
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profileErr) {
      console.error("[email-exists] profiles:", profileErr.message);
      return NextResponse.json({ exists: false, error: profileErr.message }, { status: 500 });
    }

    if (profile) {
      return NextResponse.json({ exists: true });
    }

    // Fallback: covers orphan auth-only users and profiles rows with null/mismatched `email`
    // (see `20260408120000_profiles_schema.sql`); must scan past page 1.
    let page = 1;
    while (page <= LIST_USERS_MAX_PAGES) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: LIST_USERS_PAGE_SIZE,
      });
      if (error) {
        return NextResponse.json({ exists: false, error: error.message }, { status: 500 });
      }

      const users = data?.users ?? [];
      if (users.some((u) => (u.email || "").toLowerCase() === email)) {
        return NextResponse.json({ exists: true });
      }

      if (users.length === 0 || users.length < LIST_USERS_PAGE_SIZE) break;
      page += 1;
    }

    return NextResponse.json({ exists: false });
  } catch {
    return NextResponse.json({ exists: false, error: "bad_request" }, { status: 400 });
  }
}
