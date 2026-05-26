import type { SupabaseClient } from "@supabase/supabase-js";
import { userHasAcceptedCurrentWaiver } from "@/lib/waiver/checkWaiverAccepted";
import {
  PICKUP_STANDING_LOOKBACK_DAYS,
  PICKUP_STANDING_SUSPEND_NO_SHOWS,
  PICKUP_STANDING_SUSPEND_PAYMENT_ISSUES,
  PICKUP_STANDING_WARN_LATE_CANCELS,
  PICKUP_STANDING_WARN_NO_SHOWS,
  PICKUP_STANDING_WARN_PAYMENT_ISSUES,
} from "./constants";
import type { PickupStandingAutoCode, PickupStandingLevel } from "./types";

function sinceIso(): string {
  return new Date(Date.now() - PICKUP_STANDING_LOOKBACK_DAYS * 864e5).toISOString();
}

function severityRank(s: PickupStandingLevel): number {
  switch (s) {
    case "good":
      return 0;
    case "warning":
      return 1;
    case "suspended":
      return 2;
    case "banned":
      return 3;
    default:
      return 0;
  }
}

function maxStanding(a: PickupStandingLevel, b: PickupStandingLevel): PickupStandingLevel {
  return severityRank(a) >= severityRank(b) ? a : b;
}

function deriveAutoStanding(args: {
  noShows: number;
  lateCancels: number;
  paymentIssues: number;
  waiverOk: boolean;
}): { auto: PickupStandingLevel; codes: PickupStandingAutoCode[] } {
  const codes: PickupStandingAutoCode[] = [];
  let auto: PickupStandingLevel = "good";

  if (!args.waiverOk) {
    codes.push("missing_waiver");
    auto = maxStanding(auto, "warning");
  }

  if (args.noShows >= PICKUP_STANDING_SUSPEND_NO_SHOWS) {
    codes.push("no_show_suspend");
    auto = maxStanding(auto, "suspended");
  } else if (args.noShows >= PICKUP_STANDING_WARN_NO_SHOWS) {
    codes.push("no_show_warn");
    auto = maxStanding(auto, "warning");
  }

  if (args.lateCancels >= PICKUP_STANDING_WARN_LATE_CANCELS) {
    codes.push("late_cancel_warn");
    auto = maxStanding(auto, "warning");
  }

  if (args.paymentIssues >= PICKUP_STANDING_SUSPEND_PAYMENT_ISSUES) {
    codes.push("pickup_payment_suspend");
    auto = maxStanding(auto, "suspended");
  } else if (args.paymentIssues >= PICKUP_STANDING_WARN_PAYMENT_ISSUES) {
    codes.push("pickup_payment_warn");
    auto = maxStanding(auto, "warning");
  }

  return { auto, codes };
}

/**
 * Recomputes cached automatic standing, effective standing, and pickup eligibility for one user.
 * Manual override (`manual_standing`) wins over automatic when set.
 */
export async function recomputePickupStandingForUser(admin: SupabaseClient, userId: string): Promise<void> {
  const since = sinceIso();

  const [noShowRes, lateRes, waiverOk, prevRes, payRes] = await Promise.all([
    admin
      .from("pickup_reliability_incidents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "no_show")
      .gte("created_at", since),
    admin
      .from("pickup_reliability_incidents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "late_cancel")
      .gte("created_at", since),
    userHasAcceptedCurrentWaiver(userId),
    admin.from("pickup_player_standing").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("platform_payments")
      .select("id,lifecycle_status,fulfillment_status,created_at")
      .eq("user_id", userId)
      .eq("product_type", "pickup")
      .gte("created_at", since),
  ]);

  const noShows = noShowRes.count ?? 0;
  const lateCancels = lateRes.count ?? 0;
  const prev = prevRes.data;

  const paymentIssues =
    (payRes.data || []).filter(
      (r) =>
        r.lifecycle_status === "payment_failed" ||
        (r.lifecycle_status === "payment_received" && r.fulfillment_status === "failed"),
    ).length || 0;

  const { auto, codes } = deriveAutoStanding({
    noShows,
    lateCancels,
    paymentIssues,
    waiverOk,
  });

  const manualStanding = (prev?.manual_standing ?? null) as PickupStandingLevel | null;
  const effective: PickupStandingLevel = manualStanding ?? auto;

  const pickupEligible =
    (effective === "good" || effective === "warning") && waiverOk;

  const prevEffective = (prev?.effective_standing ?? null) as PickupStandingLevel | null;
  const prevAuto = (prev?.auto_standing ?? null) as PickupStandingLevel | null;

  const now = new Date().toISOString();

  await admin.from("pickup_player_standing").upsert(
    {
      user_id: userId,
      manual_standing: prev?.manual_standing ?? null,
      manual_reason: prev?.manual_reason ?? null,
      staff_notes: prev?.staff_notes ?? null,
      manual_updated_by: prev?.manual_updated_by ?? null,
      manual_updated_at: prev?.manual_updated_at ?? null,
      auto_standing: auto,
      auto_codes: codes,
      rollup_no_shows_90d: noShows,
      rollup_late_cancels_90d: lateCancels,
      rollup_pickup_payment_issues_90d: paymentIssues,
      waiver_current: waiverOk,
      effective_standing: effective,
      pickup_eligible: pickupEligible,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );

  const prevCodes = (prev?.auto_codes ?? []) as string[];
  const materialAutoChange =
    prev &&
    (prevAuto !== auto || JSON.stringify([...prevCodes].sort()) !== JSON.stringify([...codes].sort()));

  const effectiveChanged = prev && prevEffective !== effective;

  if (prev && (materialAutoChange || effectiveChanged)) {
    await admin.from("pickup_standing_history").insert({
      user_id: userId,
      actor_id: null,
      event_type: "auto_changed",
      payload: {
        before: {
          effective_standing: prevEffective,
          auto_standing: prevAuto,
          auto_codes: prevCodes,
        },
        after: {
          effective_standing: effective,
          auto_standing: auto,
          auto_codes: codes,
        },
        rollup: {
          no_shows_90d: noShows,
          late_cancels_90d: lateCancels,
          pickup_payment_issues_90d: paymentIssues,
        },
      },
    });
  }
}
