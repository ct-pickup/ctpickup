import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

export async function requireAuthedUser(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  return { ok: true as const, admin, user };
}
