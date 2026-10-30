import { NextResponse } from "next/server";

import { requireFlag } from "@/lib/flags";
import { requireAuthedUser } from "@/lib/referral/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: whether the player shares usage data. POST { enabled: boolean }: switch it. Behind the 'analytics_client' flag. */
export async function GET(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "analytics_client", auth.user.id);
  if (off) return off;
  const { data, error } = await auth.admin.from("profiles").select("analytics_opt_out").eq("id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "We couldn’t load that." }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: (data as { analytics_opt_out?: boolean } | null)?.analytics_opt_out !== true });
}

export async function POST(req: Request) {
  const auth = await requireAuthedUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const off = await requireFlag(auth.admin, "analytics_client", auth.user.id);
  if (off) return off;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
  const { error } = await auth.admin.from("profiles").update({ analytics_opt_out: !body.enabled }).eq("id", auth.user.id);
  if (error) return NextResponse.json({ error: "We couldn’t save that." }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
