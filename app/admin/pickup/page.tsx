import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminKey = process.env.ADMIN_DASHBOARD_KEY;

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default async function AdminPickupPage({
  searchParams,
}: {
  searchParams: { key?: string; tier?: string; status?: string };
}) {
  if (adminKey && searchParams.key !== adminKey) {
    return (
      <main className="min-h-screen bg-black text-white p-10">
        <div className="text-xl font-semibold uppercase">Unauthorized</div>
        <div className="mt-3 text-white/70">
          Add <span className="text-white">?key=YOUR_ADMIN_DASHBOARD_KEY</span> to the URL.
        </div>
      </main>
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  let q = supabase
    .from("pickup_players")
    .select("created_at, full_name, age, instagram, phone, level, town, tier, status, reliability_score, notes")
    .order("created_at", { ascending: false })
    .limit(200);

  if (searchParams.tier) q = q.eq("tier", searchParams.tier);
  if (searchParams.status) q = q.eq("status", searchParams.status);

  const { data, error } = await q;

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-14 space-y-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="text-3xl font-semibold uppercase tracking-tight">ADMIN</div>
            <div className="text-white/70">Pickup applications (latest 200)</div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-white/80">
            Error: {error.message}
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
          <table className="w-full text-sm">
            <thead className="text-white/70">
              <tr className="border-b border-white/10">
                <th className="p-4 text-left">Created</th>
                <th className="p-4 text-left">Name</th>
                <th className="p-4 text-left">Age</th>
                <th className="p-4 text-left">IG</th>
                <th className="p-4 text-left">Phone</th>
                <th className="p-4 text-left">Level</th>
                <th className="p-4 text-left">Town</th>
                <th className="p-4 text-left">Tier</th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-left">Reliability</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((r, i) => (
                <tr key={i} className="border-b border-white/10 align-top">
                  <td className="p-4 whitespace-nowrap text-white/70">{fmtDate(r.created_at)}</td>
                  <td className="p-4 font-semibold text-white/90">{r.full_name || "-"}</td>
                  <td className="p-4 text-white/80">{r.age ?? "-"}</td>
                  <td className="p-4 text-white/80">{r.instagram || "-"}</td>
                  <td className="p-4 text-white/80">{r.phone || "-"}</td>
                  <td className="p-4 text-white/80">{r.level || "-"}</td>
                  <td className="p-4 text-white/80">{r.town || "-"}</td>
                  <td className="p-4 text-white/80">{r.tier || "new"}</td>
                  <td className="p-4 text-white/80">{r.status || "active"}</td>
                  <td className="p-4 text-white/80">{r.reliability_score ?? 50}</td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td className="p-6 text-white/60" colSpan={10}>
                    No pickup applications yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-white/50">
          Tier edits: use Supabase Table Editor for now (tier/status/reliability/notes). If you want inline edits on this page, say so.
        </div>
      </div>
    </main>
  );
}
