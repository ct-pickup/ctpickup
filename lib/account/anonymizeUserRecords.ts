import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountDeletionError, isUpcomingRun } from "@/lib/account/accountDeletionPlan";

const PERSONAL_KEY_TOKENS = new Set([
  "name",
  "firstname",
  "lastname",
  "fullname",
  "displayname",
  "username",
  "email",
  "phone",
  "tel",
  "cell",
  "address",
  "street",
  "city",
  "zip",
  "postal",
  "postcode",
  "dob",
  "birth",
  "birthday",
  "birthdate",
  "ip",
  "agent",
  "instagram",
  "twitter",
  "handle",
  "contact",
  "emergency",
  "guardian",
  "signature",
  "signed",
]);

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Keys that link a payment to a person or product but carry no personal details; kept even if they name the user. */
const KEPT_LINK_KEYS = new Set(["paid_for_user_id"]);

function keyTokens(key: string): string[] {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joinedPairs = words.slice(1).map((w, i) => words[i] + w);
  return [...words, ...joinedPairs, words.join("")];
}

function isPersonalKey(key: string): boolean {
  return keyTokens(key).some((t) => PERSONAL_KEY_TOKENS.has(t));
}

function stripValue(value: unknown, userId: string): { keep: boolean; value: unknown } {
  if (typeof value === "string") {
    if (EMAIL_RE.test(value) || value === userId) return { keep: false, value };
    return { keep: true, value };
  }
  if (Array.isArray(value)) {
    return { keep: true, value: value.map((v) => stripValue(v, userId)).filter((v) => v.keep).map((v) => v.value) };
  }
  if (value && typeof value === "object") return { keep: true, value: stripPersonalMetadata(value as Record<string, unknown>, userId) };
  return { keep: true, value };
}

/**
 * Removes personal details from platform_payments.metadata for a deleted user: names, emails, phones, addresses,
 * birth dates, IP addresses, social handles, signatures, any string that looks like an email, and any reference to
 * the deleted user's id except the paid_for_user_id link. Amounts, Stripe ids, run and product ids, refund details and
 * timestamps are kept.
 */
export function stripPersonalMetadata(meta: Record<string, unknown>, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (KEPT_LINK_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    if (isPersonalKey(key)) continue;
    const stripped = stripValue(value, userId);
    if (stripped.keep) out[key] = stripped.value;
  }
  return out;
}

function asMeta(m: unknown): Record<string, unknown> {
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

function anonymizeFailed(step: string, message: string): AccountDeletionError {
  const schema = /null value|not-null|violates|foreign key/i.test(message)
    ? " The database migration that allows anonymized payment records may not have run yet."
    : "";
  return new AccountDeletionError(
    "anonymize_failed",
    500,
    `Could not anonymize your payment history (${step}: ${message}), so your account was not deleted.${schema} Contact support.`,
  );
}

/**
 * Keeps every platform_payments row the user paid (user_id set to null, personal metadata stripped) and strips personal
 * metadata from rows a friend paid for this user, leaving the payer and the paid_for link in place.
 */
export async function anonymizePlatformPayments(svc: SupabaseClient, userId: string, nowIso: string): Promise<number> {
  const { data: paid, error: paidErr } = await svc.from("platform_payments").select("id,metadata").eq("user_id", userId);
  if (paidErr) throw anonymizeFailed("platform_payments select", paidErr.message);
  for (const row of paid || []) {
    const metadata = { ...stripPersonalMetadata(asMeta(row.metadata), userId), account_deleted_at: nowIso };
    const { error } = await svc
      .from("platform_payments")
      .update({ user_id: null, metadata, updated_at: nowIso })
      .eq("id", row.id);
    if (error) throw anonymizeFailed("platform_payments update", error.message);
  }

  const { data: paidFor, error: paidForErr } = await svc
    .from("platform_payments")
    .select("id,metadata")
    .eq("metadata->>paid_for_user_id", userId);
  if (paidForErr) throw anonymizeFailed("platform_payments (paid for) select", paidForErr.message);
  for (const row of paidFor || []) {
    const meta = asMeta(row.metadata);
    const metadata = stripPersonalMetadata(meta, userId);
    if (JSON.stringify(metadata) === JSON.stringify(meta)) continue;
    const { error } = await svc.from("platform_payments").update({ metadata, updated_at: nowIso }).eq("id", row.id);
    if (error) throw anonymizeFailed("platform_payments (paid for) update", error.message);
  }

  const { data: left, error: leftErr } = await svc.from("platform_payments").select("id").eq("user_id", userId);
  if (leftErr) throw anonymizeFailed("platform_payments verify", leftErr.message);
  if ((left || []).length > 0) throw anonymizeFailed("platform_payments verify", `${left!.length} rows still name the user`);
  return (paid || []).length;
}

type RsvpRow = {
  id: string;
  run_id: string;
  status: string;
  paid_at: string | null;
  payment_intent_id: string | null;
  checkout_session_id: string | null;
  refund_id: string | null;
};

/**
 * RSVPs on past or completed runs, and cancelled RSVPs that carry payment or refund ids, are kept with user_id set to
 * null. Everything else (waitlist, invites-in-progress and unpaid rows on upcoming runs) is deleted as before, so no
 * anonymous row can be promoted or counted toward an upcoming run.
 */
export async function anonymizePickupRsvps(svc: SupabaseClient, userId: string, nowMs: number): Promise<{ kept: number; deleted: number }> {
  const { data, error } = await svc
    .from("pickup_run_rsvps")
    .select("id,run_id,status,paid_at,payment_intent_id,checkout_session_id,refund_id")
    .eq("user_id", userId);
  if (error) throw anonymizeFailed("pickup_run_rsvps select", error.message);
  const rsvps = (data || []) as RsvpRow[];
  if (rsvps.length === 0) return { kept: 0, deleted: 0 };

  const runIds = [...new Set(rsvps.map((r) => r.run_id))];
  const { data: runData, error: runErr } = await svc.from("pickup_runs").select("id,status,start_at").in("id", runIds);
  if (runErr) throw anonymizeFailed("pickup_runs select", runErr.message);
  const runs = new Map<string, { status: string | null; start_at: string | null }>();
  for (const r of runData || []) runs.set(String(r.id), r as { status: string | null; start_at: string | null });

  const keep: string[] = [];
  const drop: string[] = [];
  for (const r of rsvps) {
    const run = runs.get(r.run_id);
    const past = !run || run.status === "completed" || !isUpcomingRun(run, nowMs);
    const paymentTrail = !!(r.paid_at || r.payment_intent_id || r.refund_id);
    if (past || (r.status === "canceled" && paymentTrail)) keep.push(r.id);
    else drop.push(r.id);
  }

  if (keep.length > 0) {
    const { error: upErr } = await svc
      .from("pickup_run_rsvps")
      .update({
        user_id: null,
        waitlist_position: null,
        waitlist_offered_at: null,
        waitlist_expires_at: null,
        updated_at: new Date(nowMs).toISOString(),
      })
      .in("id", keep);
    if (upErr) throw anonymizeFailed("pickup_run_rsvps update", upErr.message);
  }
  if (drop.length > 0) {
    const { error: delErr } = await svc.from("pickup_run_rsvps").delete().in("id", drop);
    if (delErr) throw anonymizeFailed("pickup_run_rsvps delete", delErr.message);
  }

  const { data: left, error: leftErr } = await svc.from("pickup_run_rsvps").select("id").eq("user_id", userId);
  if (leftErr) throw anonymizeFailed("pickup_run_rsvps verify", leftErr.message);
  if ((left || []).length > 0) throw anonymizeFailed("pickup_run_rsvps verify", `${left!.length} rows still name the user`);
  return { kept: keep.length, deleted: drop.length };
}
