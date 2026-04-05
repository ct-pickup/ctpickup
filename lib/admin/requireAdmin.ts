import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase/service";

export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Validates Authorization: Bearer <access_token> and profiles.is_admin for API routes.
 */
export async function requireAdminBearer(
  req: Request
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = supabaseService();
  const { data: authData, error } = await supabase.auth.getUser(token);
  const userId = authData.user?.id;
  if (error || !userId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (!prof?.is_admin) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true, userId };
}
