import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAdminUserIds } from "@/lib/push/adminUserIds";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { adminSeasonPush } from "@/shared/fields/requestEmail";
import { draftSeasonEmail, formatSeasonWhen } from "@/shared/fields/season";

export type SeasonPurchaseRow = {
  id: string;
  user_id: string;
  venue_key: string;
  status: string;
  requested_start_date: string;
  start_time: string;
  duration_hours: number;
  weeks: number;
  players: number;
  venue_request_id: string | null;
};

/** The one venue_requests row a paid season creates. Flagged "season", with the number of weeks, and a draft email for the admin. */
export function seasonRequestRow(p: SeasonPurchaseRow, venue: { name: string; venue_type: string | null }) {
  const draft = draftSeasonEmail({
    venueName: venue.name,
    venueKind: String(venue.venue_type ?? "").startsWith("school") ? "school" : "venue",
    startDate: p.requested_start_date,
    startTime: p.start_time,
    hours: Number(p.duration_hours),
    weeks: p.weeks,
    players: p.players,
  });
  return {
    user_id: p.user_id,
    venue_key: p.venue_key,
    requested_date: p.requested_start_date,
    start_time: p.start_time,
    duration_hours: Number(p.duration_hours),
    players: p.players,
    weeks: p.weeks,
    plan: "season",
    plan_kind: "season",
    draft_email: `${draft.subject}\n\n${draft.body}`,
  };
}

/**
 * Marks a season purchase paid and creates its single request (idempotent: Stripe can deliver the event more than once).
 * If the player already has an open request for the same field, date and time, that request is upgraded to the season instead.
 * Counts as ONE request however many weeks, and does not use up the free or included requests.
 */
export async function fulfillSeasonPurchase(
  admin: SupabaseClient,
  args: { purchaseId: string; sessionId: string | null; paymentIntentId: string | null; amountCents: number | null },
): Promise<"fulfilled" | "already" | "missing"> {
  const { data: found, error } = await admin.from("season_purchases").select("*").eq("id", args.purchaseId).maybeSingle();
  if (error) throw new Error(error.message);
  const p = found as SeasonPurchaseRow | null;
  if (!p) return "missing";
  if (p.status === "paid" && p.venue_request_id) return "already";

  const { data: venue } = await admin.from("venues").select("name,venue_type").eq("venue_key", p.venue_key).maybeSingle();
  const v = (venue as { name: string; venue_type: string | null } | null) ?? { name: p.venue_key, venue_type: null };

  const paid = await admin
    .from("season_purchases")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: args.sessionId,
      stripe_payment_intent_id: args.paymentIntentId,
      amount_cents: args.amountCents,
    })
    .eq("id", p.id);
  if (paid.error) throw new Error(paid.error.message);

  const row = seasonRequestRow(p, v);
  let requestId: string | null = null;
  const ins = await admin.from("venue_requests").insert(row).select("id").single();
  if (!ins.error) {
    requestId = (ins.data as { id: string }).id;
  } else if (ins.error.code === "23505") {
    const { data: existing } = await admin
      .from("venue_requests")
      .select("id")
      .eq("user_id", p.user_id)
      .eq("venue_key", p.venue_key)
      .eq("requested_date", p.requested_start_date)
      .eq("start_time", p.start_time)
      .in("status", ["new", "waiting_on_school", "approved"])
      .maybeSingle();
    requestId = (existing as { id: string } | null)?.id ?? null;
    if (requestId) await admin.from("venue_requests").update({ plan: row.plan, plan_kind: row.plan_kind, weeks: row.weeks, draft_email: row.draft_email }).eq("id", requestId);
  } else {
    throw new Error(ins.error.message);
  }
  if (requestId) await admin.from("season_purchases").update({ venue_request_id: requestId }).eq("id", p.id);

  try {
    const admins = await fetchAdminUserIds(admin);
    if ("ids" in admins && admins.ids.length > 0) {
      const { data: prof } = await admin.from("profiles").select("first_name,last_name,username").eq("id", p.user_id).maybeSingle();
      const pr = prof as { first_name?: string | null; last_name?: string | null; username?: string | null } | null;
      const name = [pr?.first_name, pr?.last_name].filter(Boolean).join(" ") || pr?.username || "A player";
      const msg = adminSeasonPush(name, v.name, formatSeasonWhen(p.requested_start_date, p.start_time, Number(p.duration_hours), p.weeks));
      await sendPushToUsers(admin, admins.ids, { ...msg, data: { screen: "admin/field-requests", request_id: requestId } });
    }
  } catch (e) {
    console.error("[season] admin push failed", e instanceof Error ? e.message : "unknown");
  }
  return "fulfilled";
}
