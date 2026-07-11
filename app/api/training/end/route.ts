import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { post_id } = (await req.json().catch(() => ({}))) as { post_id?: string };
  if (!post_id) return NextResponse.json({ error: "post_id is required" }, { status: 400 });

  const { data: post } = await admin
    .from("training_posts")
    .select("id, user_id")
    .eq("id", post_id)
    .maybeSingle();

  if (!post) return NextResponse.json({ error: "Training post not found" }, { status: 404 });
  if (post.user_id !== user.id) {
    return NextResponse.json({ error: "Only the host can end this training session" }, { status: 403 });
  }

  const { error } = await admin
    .from("training_posts")
    .update({ status: "ended", updated_at: new Date().toISOString() })
    .eq("id", post_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
