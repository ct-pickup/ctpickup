"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import PageTop from "@/components/PageTop";
import { AdminWorkArea } from "@/components/admin/AdminWorkArea";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type WebhookEventRow = {
  id: string;
  event_type: string;
  outcome: string;
  staff_summary: string;
  needs_retry: boolean;
  created_at: string;
};

type PaymentRow = {
  id: string;
  product_type: string;
  product_type_label: string;
  product_entity_id: string;
  staff_item_url: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  title: string;
  headline: string;
  lifecycle_label: string;
  fulfillment_label: string;
  fulfillment_message: string | null;
  amount_cents: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  stripe_payment_received_at: string | null;
  completed_at: string | null;
  refunded_at: string | null;
  metadata: Record<string, unknown>;
  webhook_events: WebhookEventRow[];
};

function fmtMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase() || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function fmt(dt: string | null) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return "—";
  }
}

function webhookOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "processed_ok":
      return "Handled successfully";
    case "processed_failed":
      return "Needs attention";
    case "ignored":
      return "No app change";
    case "received_only":
      return "Logged only";
    default:
      return outcome.replace(/_/g, " ");
  }
}

const STAFF_VIEWS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Waiting for payment" },
  { id: "awaiting_app", label: "Waiting for confirmation" },
  { id: "successful", label: "Confirmed in app" },
  { id: "failed_pay", label: "Payment failed" },
  { id: "failed_update", label: "Update needed" },
  { id: "refunded", label: "Refunded" },
  { id: "expired_checkout", label: "Checkout expired" },
] as const;

const PRODUCT_FILTERS = [
  { id: "", label: "All products" },
  { id: "pickup", label: "Pickup" },
  { id: "tournament", label: "Tournament" },
  { id: "sports", label: "Sports" },
  { id: "guidance", label: "Guidance" },
  { id: "training", label: "Training" },
] as const;

export default function PaymentsAdminClient() {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [staffView, setStaffView] = useState<string>("all");
  const [productType, setProductType] = useState("");
  const [userQ, setUserQ] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then((s) => {
      setToken(s.data.session?.access_token || null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setRows([]);
      return;
    }
    setMsg(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (staffView && staffView !== "all") params.set("staff_view", staffView);
    if (productType) params.set("product_type", productType);
    if (userQ.trim()) params.set("user", userQ.trim());
    if (q.trim()) params.set("q", q.trim());
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    params.set("limit", "100");

    const r = await fetch(`/api/admin/payments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(typeof j?.error === "string" ? j.error : "Could not load payments.");
      setRows([]);
      setTotal(0);
    } else {
      setRows((j?.payments as PaymentRow[]) || []);
      setTotal(Number(j?.total) || 0);
    }
    setLoading(false);
  }, [token, staffView, productType, userQ, q, dateFrom, dateTo]);

  useEffect(() => {
    if (!isReady) return;
    void load();
  }, [load, isReady]);

  const summary = useMemo(() => {
    if (!rows.length) return null;
    return `${rows.length} shown${total ? ` · ${total} matching` : ""}`;
  }, [rows.length, total]);

  function toggleExpand(id: string) {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  }

  return (
    <main className="min-h-screen text-white">
      <PageTop flush title="Staff · Payments" fallbackHref={APP_HOME_URL} />
      <AdminWorkArea question="Who paid, for what, and did the app finish the update?">
        <p className="text-sm text-white/60">
          Stripe-backed checkouts across pickups, tournaments, and future products. Wording below is
          for staff — not raw processor jargon.
        </p>

        {msg ? (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {msg}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {STAFF_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setStaffView(v.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  staffView === v.id
                    ? "bg-white text-black"
                    : "bg-white/10 text-white/80 hover:bg-white/15"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-white/50">
              Product
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="rounded-lg border border-white/15 bg-black px-2 py-2 text-sm text-white"
              >
                {PRODUCT_FILTERS.map((p) => (
                  <option key={p.id || "all"} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/50">
              User search
              <input
                value={userQ}
                onChange={(e) => setUserQ(e.target.value)}
                placeholder="Name or email"
                className="rounded-lg border border-white/15 bg-black px-2 py-2 text-sm text-white placeholder:text-white/35"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/50">
              Item / reference
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Title, run ID, session…"
                className="rounded-lg border border-white/15 bg-black px-2 py-2 text-sm text-white placeholder:text-white/35"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-white/50">
              <span>Date (created)</span>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-2 py-2 text-sm text-white"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-2 py-2 text-sm text-white"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !token}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            {summary ? <span className="text-xs text-white/45">{summary}</span> : null}
          </div>
        </div>

        <div className="mt-8 overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-[920px] w-full border-collapse text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-wide text-white/45">
              <tr>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Product</th>
                <th className="px-3 py-3">What they paid for</th>
                <th className="px-3 py-3">Member</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Started</th>
                <th className="px-3 py-3">Links</th>
              </tr>
            </thead>
            <tbody>
              {!token ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-white/50">
                    Sign in to load payments.
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-white/50">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-white/50">
                    No payments match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-white/[0.06] align-top">
                      <td className="px-3 py-3">
                        <div className="font-medium text-white/90">{p.headline}</div>
                        <div className="mt-1 text-xs text-white/45">
                          {p.lifecycle_label} · {p.fulfillment_label}
                        </div>
                        {p.fulfillment_message ? (
                          <div className="mt-1 text-xs text-amber-200/90">{p.fulfillment_message}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-white/80">{p.product_type_label}</td>
                      <td className="px-3 py-3">
                        <div className="text-white/90">{p.title}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-white/40">
                          Item id: {p.product_entity_id}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-white/90">{p.user_display_name || "—"}</div>
                        <div className="text-xs text-white/45">{p.user_email || p.user_id}</div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-white/90">
                        {fmtMoney(p.amount_cents, p.currency)}
                      </td>
                      <td className="px-3 py-3 text-xs text-white/55">
                        <div>{fmt(p.created_at)}</div>
                        {p.stripe_payment_received_at ? (
                          <div className="mt-1 text-white/40">Paid: {fmt(p.stripe_payment_received_at)}</div>
                        ) : null}
                        {p.refunded_at ? (
                          <div className="mt-1 text-rose-200/80">Refunded: {fmt(p.refunded_at)}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <Link
                          href={p.staff_item_url}
                          className="block text-sky-300 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open related admin page ↗
                        </Link>
                        <button
                          type="button"
                          onClick={() => toggleExpand(p.id)}
                          className="mt-2 text-left text-white/50 hover:text-white/80"
                        >
                          {expanded[p.id] ? "Hide payment details" : "Show payment details"}
                        </button>
                      </td>
                    </tr>
                    {expanded[p.id] ? (
                      <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                        <td colSpan={7} className="px-3 py-4 text-xs text-white/65">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                                Reference ids (support)
                              </div>
                              <div className="mt-2 space-y-1 font-mono text-[11px]">
                                <div>
                                  Checkout session: {p.stripe_checkout_session_id || "—"}
                                </div>
                                <div>Payment intent: {p.stripe_payment_intent_id || "—"}</div>
                                <div>User id: {p.user_id}</div>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                                Recent automated updates (webhooks)
                              </div>
                              {p.webhook_events.length === 0 ? (
                                <p className="mt-2 text-white/45">
                                  No webhook log rows stored yet for this checkout (older checkouts or
                                  events before this feature).
                                </p>
                              ) : (
                                <ul className="mt-2 space-y-2">
                                  {p.webhook_events.map((w) => (
                                    <li
                                      key={w.id}
                                      className="rounded-lg border border-white/10 bg-black/40 px-3 py-2"
                                    >
                                      <div className="flex flex-wrap items-center gap-2 text-white/80">
                                        <span className="font-medium">{webhookOutcomeLabel(w.outcome)}</span>
                                        {w.needs_retry ? (
                                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">
                                            Retry may help
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 text-white/70">{w.staff_summary}</div>
                                      <div className="mt-1 text-[10px] text-white/35">
                                        {fmt(w.created_at)} · {w.event_type.replace(/\./g, " · ")}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminWorkArea>
    </main>
  );
}
