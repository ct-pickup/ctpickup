import PageTop from "@/components/PageTop";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type PickupRun = {
  id: string;
  title: string | null;
  status: "planning" | "likely_on" | "active" | string;
  start_at: string | null;
  created_at: string;
  run_type?: string | null;
};

type RunUpdate = {
  id: string | number;
  run_id: string | null;
  message: string;
  created_by: string | null;
  created_at: string;
};

function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env vars");
  return createClient(url, anon, { auth: { persistSession: false } });
}

function formatNY(ts: string) {
  const d = new Date(ts);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function pillForRunStatus(status: string) {
  if (status === "active")
    return {
      label: "Active",
      cls: "border-emerald-500/25 bg-emerald-500/15 text-emerald-200",
    };
  if (status === "likely_on")
    return {
      label: "Likely on",
      cls: "border-white/15 bg-white/10 text-white/85",
    };
  if (status === "planning")
    return {
      label: "Planning",
      cls: "border-white/15 bg-white/10 text-white/85",
    };
  return {
    label: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " "),
    cls: "border-white/15 bg-white/10 text-white/85",
  };
}

async function loadData() {
  const supabase = supabaseServer();

  // 1) latest global update (run_id is null)
  const globalRes = await supabase
    .from("pickup_run_updates")
    .select("id, run_id, message, created_by, created_at")
    .is("run_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const globalUpdate = (globalRes.data as RunUpdate | null) ?? null;

  // 2) Public status board: promoted public run, else newest public scheduled run.
  // Select/invite runs are omitted here so unauthenticated visitors do not see them.
  const curRes = await supabase
    .from("pickup_runs")
    .select("id, title, status, start_at, created_at, run_type")
    .eq("is_current", true)
    .neq("status", "canceled")
    .maybeSingle();

  let run: PickupRun | null = null;
  if (curRes.data?.run_type === "public") {
    run = curRes.data as PickupRun;
  }

  if (!run) {
    const runRes = await supabase
      .from("pickup_runs")
      .select("id, title, status, start_at, created_at, run_type")
      .in("status", ["planning", "likely_on", "active"])
      .eq("run_type", "public")
      .order("start_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5);

    const rows = (runRes.data as PickupRun[] | null) ?? [];
    run = rows[0] ?? null;
  }

  // 3) latest update for that run
  let runUpdate: RunUpdate | null = null;
  if (run?.id) {
    const runUpdateRes = await supabase
      .from("pickup_run_updates")
      .select("id, run_id, message, created_by, created_at")
      .eq("run_id", run.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    runUpdate = (runUpdateRes.data as RunUpdate | null) ?? null;
  }

  // Optional recent feed (simple)
  const feedRes = await supabase
    .from("pickup_run_updates")
    .select("id, run_id, message, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(12);

  const feed = (feedRes.data as RunUpdate[] | null) ?? [];

  return {
    globalUpdate,
    run,
    runUpdate,
    feed,
  };
}

export default async function PickupStatusPage() {
  let globalUpdate: RunUpdate | null = null;
  let run: PickupRun | null = null;
  let runUpdate: RunUpdate | null = null;
  let feed: RunUpdate[] = [];

  try {
    const data = await loadData();
    globalUpdate = data.globalUpdate;
    run = data.run;
    runUpdate = data.runUpdate;
    feed = data.feed;
  } catch {
    // keep nulls; page will show neutral fallback
  }

  const hasSomething = !!globalUpdate || !!runUpdate || !!run;

  return (
    <main className="min-h-screen bg-[#0f0f10] text-white">
      <div className="mx-auto max-w-6xl px-6 pt-2">
        <PageTop flush title="STATUS" fallbackHref="/pickup" />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-14 space-y-10">
        {/* Neutral fallback if nothing exists */}
        {!hasSomething && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
              Pickup Status
            </div>
            <div className="mt-4 text-lg font-semibold text-white/90">
              No updates right now.
            </div>
            <div className="mt-2 text-sm text-white/60">
              When a run is being formed or finalized, updates will appear here.
            </div>
          </section>
        )}

        {/* 1) Global update first */}
        {globalUpdate && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                Everyone
              </div>
              <div className="text-xs text-white/55">
                {formatNY(globalUpdate.created_at)}
              </div>
            </div>

            <div className="text-base text-white/85 whitespace-pre-line leading-relaxed">
              {globalUpdate.message}
            </div>
          </section>
        )}

        {/* 2) Most relevant run update underneath */}
        {run && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={[
                    "inline-flex rounded-full px-4 py-2 text-sm font-semibold border",
                    pillForRunStatus(run.status).cls,
                  ].join(" ")}
                >
                  Pickup · {pillForRunStatus(run.status).label}
                </div>

                <div className="text-sm text-white/70">
                  {run.start_at ? formatNY(run.start_at) : "TBD"}
                </div>
              </div>

              <div className="text-xs text-white/55">
                {run.title ? run.title : "Pickup run"}
              </div>
            </div>

            {runUpdate ? (
              <div className="text-base text-white/85 whitespace-pre-line leading-relaxed">
                {runUpdate.message}
              </div>
            ) : (
              <div className="text-sm text-white/70">
                No run-specific update yet.
              </div>
            )}
          </section>
        )}

        {/* If there was no global update, we still show run section only (already handled above) */}

        {/* 3) Optional recent feed */}
        {feed.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-4">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
              Recent
            </div>

            <div className="space-y-3">
              {feed.map((u) => (
                <div
                  key={String(u.id)}
                  className="rounded-xl border border-white/10 bg-black/30 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs uppercase tracking-widest text-white/55">
                      {u.run_id ? "One run" : "Everyone"}
                    </div>
                    <div className="text-xs text-white/55">
                      {formatNY(u.created_at)}
                    </div>
                  </div>

                  <div className="mt-2 text-sm text-white/80 whitespace-pre-line leading-relaxed">
                    {u.message}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}