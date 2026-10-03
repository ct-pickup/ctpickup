import { NextResponse } from "next/server";

import { isProfilePhotoRequired } from "@/lib/profilePhoto/requirement";
import { photoWasRemoved } from "@/lib/profilePhoto/reports";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { hasProfilePhoto } from "@/shared/profilePhoto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: { required, has_photo, removed }. `required` mirrors REQUIRE_PROFILE_PHOTO so the app blocks join/host
 * only when the server does. Signed out callers get `required` alone.
 */
export async function GET(req: Request) {
  const required = isProfilePhotoRequired();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ required });

  const admin = getSupabaseAdmin();
  const { data } = await admin.auth.getUser(token);
  const userId = data.user?.id;
  if (!userId) return NextResponse.json({ required });

  const prof = await admin.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
  const hasPhoto = hasProfilePhoto((prof.data as { avatar_url?: string | null } | null)?.avatar_url);
  const removed = hasPhoto ? false : await photoWasRemoved(admin, userId);
  return NextResponse.json({ required, has_photo: hasPhoto, removed });
}
