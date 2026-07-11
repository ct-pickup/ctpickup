import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type Body = { request_id?: string; decision?: "accepted" | "declined" };

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { request_id, decision } = (await req.json().catch(() => ({}))) as Body;
  if (!request_id) return NextResponse.json({ error: "request_id is required" }, { status: 400 });
  if (decision !== "accepted" && decision !== "declined") {
    return NextResponse.json({ error: "decision must be 'accepted' or 'declined'" }, { status: 400 });
  }

  const { data: joinReq } = await admin
    .from("training_join_requests")
    .select("id, requester_id, status, training_post_id")
    .eq("id", request_id)
    .maybeSingle();

  if (!joinReq) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const { data: post } = await admin
    .from("training_posts")
    .select("id, user_id, field_name, spots_available")
    .eq("id", joinReq.training_post_id)
    .maybeSingle();

  if (!post) return NextResponse.json({ error: "Training post not found" }, { status: 404 });
  if (post.user_id !== user.id) {
    return NextResponse.json({ error: "Only the host can respond to requests" }, { status: 403 });
  }

  const { error: updateErr } = await admin
    .from("training_join_requests")
    .update({ status: decision })
    .eq("id", request_id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Free up a spot only on the transition into accepted.
  if (decision === "accepted" && joinReq.status !== "accepted") {
    const nextSpots = Math.max(0, (post.spots_available ?? 0) - 1);
    await admin
      .from("training_posts")
      .update({ spots_available: nextSpots, updated_at: new Date().toISOString() })
      .eq("id", post.id);
  }

  const { data: host } = await admin
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", user.id)
    .maybeSingle();

  const hostName =
    [host?.first_name, host?.last_name].filter(Boolean).join(" ") || host?.username || "The host";

  const payload =
    decision === "accepted"
      ? {
          title: "Request accepted ✅",
          body: `${hostName} accepted your training request at ${post.field_name}`,
        }
      : {
          title: "Training request",
          body: `${hostName} is full or declined your request`,
        };

  await sendPushToUsers(admin, [joinReq.requester_id], {
    ...payload,
    data: { screen: `training/${post.id}`, post_id: post.id },
  });

  return NextResponse.json({ ok: true });
}
