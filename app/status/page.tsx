import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type StatusRow = {
  id: number;
  phase: string;
  primary_slot: string | null;
  secondary_slot: string | null;
  next_update_by: string | null;
  announcement: string | null;
  updated_at: string;
  updated_by: string | null;
};

function supabasePublic() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

function prettyDate(iso: string | null) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default async function StatusPage() {
  const supabase = supabasePublic();

  const { data, error } = await supabase
    .from("status_updates")
    .select("*")
    .eq("id", 1)
    .single<StatusRow>();

  if (error || !data) {
    return (
      <main className="ct-page">
        <div className="ct-container">
          <div className="ct-topbar">
            <div className="ct-brand">CT PICKUP</div>
            <div className="ct-nav">
              <a href="/status">Status</a>
              <a href="/update">Fix Submission</a>
            </div>
          </div>

          <h1 className="ct-title">Tournament Status</h1>
          <p className="ct-sub">Official source of truth.</p>

          <div className="mt-6 ct-card">
            <p style={{ color: "var(--ct-muted)" }}>
              Couldn’t load status yet. Check env vars + Supabase table.
            </p>
            <pre className="mt-4 text-sm whitespace-pre-wrap">{String(error?.message)}</pre>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ct-page">
      <div className="ct-container">
        <div className="ct-topbar">
          <div className="ct-brand">CT PICKUP</div>
          <div className="ct-nav">
            <a href="/status">Status</a>
            <a href="/update">Fix Submission</a>
          </div>
        </div>

        <h1 className="ct-title">Tournament Status</h1>
        <p className="ct-sub">
          Official source of truth. Updates live here + IG story.
        </p>

        <div className="mt-6 grid gap-3">
          <div className="ct-card">
            <div className="ct-k">Current phase</div>
            <div className="text-xl font-extrabold mt-1">{data.phase}</div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Next update by</div>
            <div className="text-lg font-bold mt-1">
              {prettyDate(data.next_update_by)}
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Leading options</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div
                className="rounded-xl border p-3"
                style={{ borderColor: "rgba(255,255,255,0.10)" }}
              >
                <div className="ct-k">Primary</div>
                <div className="ct-v mt-1">{data.primary_slot ?? "TBD"}</div>
              </div>
              <div
                className="rounded-xl border p-3"
                style={{ borderColor: "rgba(255,255,255,0.10)" }}
              >
                <div className="ct-k">Secondary</div>
                <div className="ct-v mt-1">
                  {data.secondary_slot ?? "TBD"}
                </div>
              </div>
            </div>
            <div className="ct-foot">We lock a slot when enough players align.</div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Captain notes</div>
            <div className="mt-2 text-sm" style={{ color: "var(--ct-muted2)" }}>
              Captains: check deadlines here. Make sure every player submits the form.
            </div>
          </div>

          <div className="ct-card">
            <div className="ct-k">Announcement</div>
            <div className="mt-2 text-sm whitespace-pre-wrap" style={{ color: "var(--ct-muted2)" }}>
              {data.announcement ?? ""}
            </div>
            <div className="ct-foot">
              Last updated: {prettyDate(data.updated_at)}
              {data.updated_by ? ` by ${data.updated_by}` : ""}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
