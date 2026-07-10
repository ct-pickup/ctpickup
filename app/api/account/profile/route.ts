import { NextResponse } from "next/server";
import { ensureProfileRowForAuthUser } from "@/lib/profile/ensureProfileRowForAuthUser";
import {
  normalizeProfileUsername,
  PROFILE_USERNAME_MAX_LEN,
  USERNAME_TAKEN_USER_MESSAGE,
} from "@/lib/profileIdentityFields";
import { allocateUniqueProfileUsername } from "@/lib/profileUsernameAllocate";
import { isMissingProfileColumnError } from "@/lib/profileLoad";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSITIONS = new Set(["Goalkeeper", "Defender", "Midfielder", "Attacker"]);

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

function formatSupabaseError(err: { message?: string; details?: string; hint?: string; code?: string }): string {
  const parts = [err.message, err.details, err.hint].filter((s) => typeof s === "string" && s.trim());
  if (parts.length) return parts.join(" — ");
  if (err.code) return `Error code ${err.code}`;
  return "Unknown Supabase error";
}

function looksLikeMissingNearestVenueColumn(err: { message?: string } | null | undefined): boolean {
  const msg = err?.message ?? "";
  if (!msg) return false;
  return /nearest_venue/i.test(msg) && isMissingProfileColumnError(msg);
}

function sanitizeNearestVenue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t.length) return null;
  return t.slice(0, 500);
}

function sanitizeZip(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "").slice(0, 5);
  return d.length === 5 ? d : null;
}

function sanitizePlayingPosition(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  return POSITIONS.has(v) ? v : null;
}

function sanitizeText(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t.length) return null;
  return t.slice(0, max);
}

async function profileUsernameTakenByOther(
  admin: ReturnType<typeof getSupabaseAdmin>,
  candidate: string,
  excludeUserId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .ilike("username", candidate)
    .neq("id", excludeUserId)
    .maybeSingle();
  if (error) {
    console.error("[account/profile] username uniqueness check failed:", error.message ?? error);
    return true;
  }
  return Boolean(data?.id);
}

export async function PATCH(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user?.id) {
    console.log("[account/profile] auth.getUser failed:", authErr?.message ?? "no user");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "Body must be a JSON object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const first_name = sanitizeText(b.first_name, 120);
  const last_name = sanitizeText(b.last_name, 120);
  const playing_position = sanitizePlayingPosition(b.playing_position);
  const instagram = sanitizeText(b.instagram, 200)?.replace(/^@/, "") ?? null;
  const phone = sanitizeText(b.phone, 40);
  const zip_code = sanitizeZip(b.zip_code);
  const usernameFromBody = sanitizeText(b.username, PROFILE_USERNAME_MAX_LEN);
  const nearest_venue = sanitizeNearestVenue(b.nearest_venue);

  const { data: existingProf, error: existingErr } = await admin
    .from("profiles")
    .select("username,first_name,last_name")
    .eq("id", userId)
    .maybeSingle();

  if (existingErr) {
    console.error("[account/profile] could not load existing profile:", existingErr.message ?? existingErr);
    return NextResponse.json({ ok: false, error: "Could not load profile." }, { status: 400 });
  }

  const storedUsername =
    typeof existingProf?.username === "string" && existingProf.username.trim()
      ? existingProf.username.trim()
      : null;
  const storedFirst =
    typeof existingProf?.first_name === "string" && existingProf.first_name.trim()
      ? existingProf.first_name.trim()
      : null;
  const storedLast =
    typeof existingProf?.last_name === "string" && existingProf.last_name.trim()
      ? existingProf.last_name.trim()
      : null;

  const effectiveFirst = first_name ?? storedFirst;
  const effectiveLast = last_name ?? storedLast;

  let resolvedUsername: string | null;

  if (usernameFromBody) {
    const lower = usernameFromBody.toLowerCase();
    if (storedUsername && storedUsername.toLowerCase() === lower) {
      resolvedUsername = storedUsername;
    } else {
      const norm = normalizeProfileUsername(usernameFromBody);
      if (!norm) {
        return NextResponse.json(
          {
            ok: false,
            error: "Username must be 3–30 characters, lowercase letters and numbers only.",
          },
          { status: 400 },
        );
      }
      resolvedUsername = norm;
    }
  } else if (storedUsername) {
    resolvedUsername = storedUsername;
  } else if (effectiveFirst && effectiveLast) {
    resolvedUsername = await allocateUniqueProfileUsername(admin, effectiveFirst, effectiveLast, userId);
  } else {
    resolvedUsername = null;
  }

  if (resolvedUsername) {
    const unchanged =
      storedUsername && storedUsername.toLowerCase() === resolvedUsername.toLowerCase();
    if (!unchanged && (await profileUsernameTakenByOther(admin, resolvedUsername, userId))) {
      return NextResponse.json({ ok: false, error: USERNAME_TAKEN_USER_MESSAGE }, { status: 400 });
    }
  }

  const updatedAt = new Date().toISOString();
  const primary_position = typeof b.primary_position === "string" ? b.primary_position.trim() || null : null;
  const secondary_positions = Array.isArray(b.secondary_positions) ? b.secondary_positions.filter((p: unknown) => typeof p === "string") : null;
  const experience_level = typeof b.experience_level === "string" ? b.experience_level.trim() || null : null;
  const date_of_birth = typeof b.date_of_birth === "string" ? b.date_of_birth.trim() || null : null;
  const club_name = typeof b.club_name === "string" ? b.club_name.trim() || null : null;
  const roster_url = typeof b.roster_url === "string" ? b.roster_url.trim() || null : null;

  const coreUpdate = {
    first_name,
    last_name,
    playing_position,
    instagram,
    phone,
    zip_code,
    username: resolvedUsername,
    updated_at: updatedAt,
    primary_position,
    secondary_positions,
    experience_level,
    date_of_birth,
    club_name,
    roster_url,
  };

  await ensureProfileRowForAuthUser({ id: userId, email: user.email ?? null });

  const withVenue = { ...coreUpdate, nearest_venue };
  let res = await admin.from("profiles").update(withVenue).eq("id", userId).select("id");

  if (res.error && looksLikeMissingNearestVenueColumn(res.error)) {
    res = await admin.from("profiles").update(coreUpdate).eq("id", userId).select("id");
  }

  if (res.error) {
    const code = (res.error as { code?: string }).code;
    const dup =
      code === "23505" ||
      /profiles_username_lower_unique|duplicate key/i.test(String(res.error.message ?? ""));
    if (dup) {
      return NextResponse.json({ ok: false, error: USERNAME_TAKEN_USER_MESSAGE }, { status: 400 });
    }
    const msg = formatSupabaseError(res.error);
    console.error("[account/profile] update error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  if (!res.data?.length) {
    const msg =
      "Save did not update any profile row (no match, RLS blocked update, or missing profile row).";
    console.error("[account/profile] update returned 0 rows for userId:", userId);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
