import { NextResponse } from "next/server";
import {
  fulfillmentLabel,
  lifecycleLabel,
  productTypeLabel,
  staffPaymentHeadline,
  staffProductLink,
  type FulfillmentStatus,
  type PaymentLifecycleStatus,
  type PlatformProductType,
} from "@/lib/payments/platformPaymentModel";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const PRODUCT_TYPES = new Set<string>(["pickup", "tournament", "sports", "guidance", "training"]);

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

type PlatformPaymentRow = Record<string, unknown> & {
  id: string;
  product_type: string;
  product_entity_id: string;
  user_id: string;
  title: string;
  lifecycle_status: string;
  fulfillment_status: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  currency: string;
  created_at: string;
  completed_at: string | null;
  refunded_at: string | null;
  fulfillment_message: string | null;
  stripe_payment_received_at: string | null;
  metadata: Record<string, unknown> | null;
};

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();

  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const productType = url.searchParams.get("product_type") || "";
  const lifecycleStatus = url.searchParams.get("lifecycle_status") || "";
  const fulfillmentStatus = url.searchParams.get("fulfillment_status") || "";
  const staffView = url.searchParams.get("staff_view") || "all";
  const dateFrom = url.searchParams.get("date_from") || "";
  const dateTo = url.searchParams.get("date_to") || "";
  const userQ = url.searchParams.get("user") || "";
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(150, Math.max(1, Number(url.searchParams.get("limit") || 80)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let userIdsFilter: string[] | null = null;
  if (userQ.trim()) {
    const needle = sanitizeIlike(userQ.trim());
    const { data: matches } = await admin
      .from("profiles")
      .select("id")
      .or(
        `email.ilike.%${needle}%,first_name.ilike.%${needle}%,last_name.ilike.%${needle}%`,
      )
      .limit(200);
    userIdsFilter = (matches || []).map((r) => r.id as string);
    if (userIdsFilter.length === 0) {
      return NextResponse.json({ payments: [], total: 0, staff_view: staffView });
    }
  }

  let query = admin
    .from("platform_payments")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (productType && PRODUCT_TYPES.has(productType)) {
    query = query.eq("product_type", productType);
  }

  if (lifecycleStatus && isLifecycle(lifecycleStatus)) {
    query = query.eq("lifecycle_status", lifecycleStatus);
  }

  if (fulfillmentStatus && isFulfillment(fulfillmentStatus)) {
    query = query.eq("fulfillment_status", fulfillmentStatus);
  } else if (!lifecycleStatus && staffView !== "all" && staffView) {
    query = applyStaffViewToQuery(query, staffView);
  }

  if (userIdsFilter) {
    query = query.in("user_id", userIdsFilter);
  }

  if (dateFrom) {
    const fromIso = dateFrom.includes("T") ? dateFrom : `${dateFrom}T00:00:00.000Z`;
    query = query.gte("created_at", fromIso);
  }
  if (dateTo) {
    const toIso = dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999Z`;
    query = query.lte("created_at", toIso);
  }

  if (q.trim()) {
    const n = sanitizeIlike(q.trim());
    query = query.or(
      `title.ilike.%${n}%,product_entity_id.ilike.%${n}%,stripe_checkout_session_id.ilike.%${n}%,stripe_payment_intent_id.ilike.%${n}%`,
    );
  }

  const { data: rawRows, error, count } = await query;

  if (error) {
    console.error("[admin/payments]", error.message);
    return NextResponse.json({ error: "Could not load payments." }, { status: 500 });
  }

  const rows = (rawRows || []) as PlatformPaymentRow[];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = userIds.length
    ? await admin
        .from("profiles")
        .select("id,email,first_name,last_name")
        .in("id", userIds)
    : { data: [] as Record<string, unknown>[] };

  const profileById = new Map<string, Record<string, unknown>>();
  for (const p of profiles || []) {
    profileById.set(String(p.id), p);
  }

  const paymentIds = rows.map((r) => r.id);
  const webhookByPayment: Record<
    string,
    {
      id: string;
      event_type: string;
      outcome: string;
      staff_summary: string;
      needs_retry: boolean;
      created_at: string;
    }[]
  > = {};

  if (paymentIds.length) {
    const { data: evs } = await admin
      .from("stripe_webhook_events")
      .select("id,platform_payment_id,event_type,outcome,staff_summary,needs_retry,created_at")
      .in("platform_payment_id", paymentIds);

    const byPay = new Map<
      string,
      {
        id: string;
        platform_payment_id: string | null;
        event_type: string;
        outcome: string;
        staff_summary: string;
        needs_retry: boolean;
        created_at: string;
      }[]
    >();
    for (const e of evs || []) {
      const pid = e.platform_payment_id as string | null;
      if (!pid) continue;
      const arr = byPay.get(pid) || [];
      arr.push({
        id: e.id as string,
        platform_payment_id: pid,
        event_type: e.event_type as string,
        outcome: e.outcome as string,
        staff_summary: e.staff_summary as string,
        needs_retry: Boolean(e.needs_retry),
        created_at: e.created_at as string,
      });
      byPay.set(pid, arr);
    }
    for (const [pid, arr] of byPay) {
      arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      webhookByPayment[pid] = arr.slice(0, 8).map((x) => ({
        id: x.id,
        event_type: x.event_type,
        outcome: x.outcome,
        staff_summary: x.staff_summary,
        needs_retry: x.needs_retry,
        created_at: x.created_at,
      }));
    }
  }

  const payments = rows.map((r) => {
    const p = profileById.get(r.user_id);
    const pt = r.product_type as PlatformProductType;
    const life = r.lifecycle_status as PaymentLifecycleStatus;
    const ful = r.fulfillment_status as FulfillmentStatus;
    const email = p?.email != null ? String(p.email) : null;
    const fn = p?.first_name != null ? String(p.first_name) : "";
    const ln = p?.last_name != null ? String(p.last_name) : "";
    const fullName = `${fn} ${ln}`.trim() || null;

    return {
      id: r.id,
      product_type: r.product_type,
      product_type_label: productTypeLabel(pt),
      product_entity_id: r.product_entity_id,
      staff_item_url: staffProductLink(pt, r.product_entity_id),
      user_id: r.user_id,
      user_email: email,
      user_display_name: fullName,
      title: r.title,
      headline: staffPaymentHeadline({ lifecycle_status: life, fulfillment_status: ful }),
      lifecycle_status: r.lifecycle_status,
      lifecycle_label: lifecycleLabel(life),
      fulfillment_status: r.fulfillment_status,
      fulfillment_label: fulfillmentLabel(ful),
      fulfillment_message: r.fulfillment_message,
      amount_cents: r.amount_cents,
      currency: r.currency,
      stripe_checkout_session_id: r.stripe_checkout_session_id,
      stripe_payment_intent_id: r.stripe_payment_intent_id,
      created_at: r.created_at,
      stripe_payment_received_at: r.stripe_payment_received_at,
      completed_at: r.completed_at,
      refunded_at: r.refunded_at,
      metadata: r.metadata || {},
      webhook_events: webhookByPayment[r.id] || [],
    };
  });

  return NextResponse.json({
    payments,
    total: count ?? rows.length,
    staff_view: staffView,
  });
}

function isLifecycle(s: string): s is PaymentLifecycleStatus {
  return (
    s === "checkout_started" ||
    s === "payment_received" ||
    s === "payment_failed" ||
    s === "refunded" ||
    s === "checkout_expired"
  );
}

function isFulfillment(s: string): s is FulfillmentStatus {
  return s === "pending" || s === "succeeded" || s === "failed" || s === "not_applicable";
}

function sanitizeIlike(raw: string) {
  return raw.replace(/%/g, "").replace(/_/g, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStaffViewToQuery(query: any, staffView: string) {
  if (staffView === "pending") {
    return query.eq("lifecycle_status", "checkout_started");
  }
  if (staffView === "awaiting_app") {
    return query.eq("lifecycle_status", "payment_received").eq("fulfillment_status", "pending");
  }
  if (staffView === "successful") {
    return query.eq("lifecycle_status", "payment_received").eq("fulfillment_status", "succeeded");
  }
  if (staffView === "failed_pay") {
    return query.eq("lifecycle_status", "payment_failed");
  }
  if (staffView === "failed_update") {
    return query.eq("lifecycle_status", "payment_received").eq("fulfillment_status", "failed");
  }
  if (staffView === "refunded") {
    return query.eq("lifecycle_status", "refunded");
  }
  if (staffView === "expired_checkout") {
    return query.eq("lifecycle_status", "checkout_expired");
  }
  return query;
}
