import { NextResponse } from "next/server";
import { enforcePersistentRateLimit } from "@/lib/server/persistentRateLimit";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

/**
 * `auth.admin.listUsers` is paginated; the old route only read page 1 and falsely reported
 * "no account" once there were more users than fit on that page.
 */
const LIST_USERS_PAGE_SIZE = 1000;
/** Safety cap so a pathological case cannot loop unbounded. */
const LIST_USERS_MAX_PAGES = 500;

const RATE_LIMIT_PER_MINUTE = 3;

function randomDelayMs(): number {
  return 200 + Math.floor(Math.random() * 601);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const rateLimited = await enforcePersistentRateLimit(req, {
    route: "auth/email-exists",
    limit: RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimited) return rateLimited;

  const delayMs = randomDelayMs();
  const startedAt = Date.now();

  try {
    const admin = getSupabaseAdmin({
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
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
      await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
      return NextResponse.json({ exists: false, error: profileErr.message }, { status: 500 });
    }

    if (profile) {
      await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
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
        await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
        return NextResponse.json({ exists: false, error: error.message }, { status: 500 });
      }

      const users = data?.users ?? [];
      if (users.some((u) => (u.email || "").toLowerCase() === email)) {
        await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
        return NextResponse.json({ exists: true });
      }

      if (users.length === 0 || users.length < LIST_USERS_PAGE_SIZE) break;
      page += 1;
    }

    await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
    return NextResponse.json({ exists: false });
  } catch {
    await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
    return NextResponse.json({ exists: false, error: "bad_request" }, { status: 400 });
  }
}
