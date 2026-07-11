import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

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
    .select("id, user_id, field_name, status")
    .eq("id", post_id)
    .maybeSingle();

  if (!post) return NextResponse.json({ error: "Training post not found" }, { status: 404 });
  if (post.user_id === user.id) {
    return NextResponse.json({ error: "You can't request to join your own training" }, { status: 400 });
  }
  if (post.status !== "active") {
    return NextResponse.json({ error: "This training session has ended" }, { status: 400 });
  }

  const { error } = await admin
    .from("training_join_requests")
    .insert({ training_post_id: post_id, requester_id: user.id, status: "pending" });

  // Unique violation → already requested; treat as success and skip the push.
  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true, already_requested: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: requester } = await admin
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", user.id)
    .maybeSingle();

  const requesterName =
    [requester?.first_name, requester?.last_name].filter(Boolean).join(" ") ||
    requester?.username ||
    "Someone";

  await sendPushToUsers(admin, [post.user_id], {
    title: "Training request 🤝",
    body: `${requesterName} wants to train with you`,
    data: { screen: `training/${post_id}`, post_id },
  });

  return NextResponse.json({ ok: true });
}
