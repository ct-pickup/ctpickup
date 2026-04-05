import PageTop from "@/components/PageTop";
import { AdminHubNav } from "@/components/admin/AdminHubNav";
import { APP_HOME_URL } from "@/lib/siteNav";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import {
  clearActiveTournament,
  createTournament,
  setActiveTournament,
  updateTourneySubmission,
} from "./actions";

export const dynamic = "force-dynamic";

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default async function AdminTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string; ok?: string; e?: string }>;
}) {
  const sp = await searchParams;
  const filterDecision = sp.decision;

  let supabase;
  try {
    supabase = getSupabaseAdmin({ auth: { persistSession: false } });
  } catch {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 pt-10 pb-10">
          <PageTop flush title="ADMIN · TOURNAMENT" fallbackHref={APP_HOME_URL} />
          <p className="mt-6 text-white/80">Missing Supabase env vars.</p>
        </div>
      </main>
    );
  }

  const [{ data: tournaments, error: tListErr }, { data: activeT, error: activeErr }] = await Promise.all([
    supabase.from("tournaments").select("*").order("created_at", { ascending: false }),
    supabase.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle(),
  ]);

  let captains: Record<string, unknown>[] = [];
  let captainsErr: string | null = null;
  if (activeT?.id) {
    const cRes = await supabase
      .from("tournament_captains")
      .select(
        "id,user_id,status,captain_name,captain_instagram,team_name,expected_players,captain_verified,claim_submitted_at,payment_due_at"
      )
      .eq("tournament_id", activeT.id)
      .order("claim_submitted_at", { ascending: false });
    captains = (cRes.data || []) as Record<string, unknown>[];
    if (cRes.error) captainsErr = cRes.error.message;
  }

  let q = supabase
    .from("tourney_submissions")
    .select(
      "id, created_at, full_name, age, instagram, phone, level, availability, decision, reviewed, notes"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filterDecision) {
    q = q.eq("decision", filterDecision);
  }

  const { data: submissions, error: subErr } = await q;

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <PageTop flush title="ADMIN · TOURNAMENT" fallbackHref={APP_HOME_URL} />
        <AdminHubNav />

        {sp.ok ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {sp.ok === "active" && "Active tournament updated."}
            {sp.ok === "cleared" && "No tournament is active on the public site."}
            {sp.ok === "created" && "Tournament created (inactive until you activate it)."}
            {sp.ok === "saved" && "Submission saved."}
          </div>
        ) : null}
        {sp.e ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {sp.e}
          </div>
        ) : null}

        {/* Public site driver: tournaments.is_active */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold uppercase tracking-tight text-white">
              Active tournament (public)
            </h2>
            <p className="mt-1 text-sm text-white/55">
              The row with <span className="text-white/75">is_active = true</span> is what{" "}
              <code className="text-white/80">/api/tournament/public</code> and the tournament hub use.
            </p>
          </div>

          {activeErr ? (
            <p className="text-sm text-red-300">{activeErr.message}</p>
          ) : activeT ? (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/85 space-y-1">
              <div className="font-semibold text-white">{activeT.title}</div>
              <div className="text-white/60">
                slug: {activeT.slug} · target {activeT.target_teams} · official ≥{" "}
                {activeT.official_threshold} · max {activeT.max_teams}
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/60">No active tournament — public pages show an empty state.</p>
          )}

          {tListErr ? (
            <p className="text-sm text-red-300">{tListErr.message}</p>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/45">
                All tournaments
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="text-white/60">
                    <tr className="border-b border-white/10">
                      <th className="p-3 text-left">Title</th>
                      <th className="p-3 text-left">Slug</th>
                      <th className="p-3 text-left">Target / official / max</th>
                      <th className="p-3 text-left">Active</th>
                      <th className="p-3 text-left"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tournaments || []).length === 0 ? (
                      <tr>
                        <td className="p-4 text-white/50" colSpan={5}>
                          No tournament rows yet. Create one below.
                        </td>
                      </tr>
                    ) : (
                      (tournaments || []).map((t) => (
                        <tr key={t.id} className="border-b border-white/10 align-top">
                          <td className="p-3 text-white/90">{t.title}</td>
                          <td className="p-3 text-white/70">{t.slug}</td>
                          <td className="p-3 text-white/70">
                            {t.target_teams} / {t.official_threshold} / {t.max_teams}
                          </td>
                          <td className="p-3 text-white/80">{t.is_active ? "Yes" : "No"}</td>
                          <td className="p-3">
                            {!t.is_active ? (
                              <form action={setActiveTournament}>
                                <input type="hidden" name="tournament_id" value={t.id} />
                                <button
                                  type="submit"
                                  className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black"
                                >
                                  Set active
                                </button>
                              </form>
                            ) : (
                              <form action={clearActiveTournament}>
                                <button
                                  type="submit"
                                  className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/85"
                                >
                                  Deactivate
                                </button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="border-t border-white/10 pt-6 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/45">
              Create tournament
            </div>
            <form action={createTournament} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input
                name="title"
                required
                placeholder="Title"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
              <input
                name="slug"
                placeholder="Slug (optional)"
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
              <input
                name="target_teams"
                type="number"
                min={1}
                defaultValue={12}
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <input
                name="official_threshold"
                type="number"
                min={1}
                defaultValue={8}
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <input
                name="max_teams"
                type="number"
                min={1}
                defaultValue={12}
                required
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <div className="flex items-end">
                <button
                  type="submit"
                  className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
                >
                  Create (inactive)
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Captain claims for active tournament */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <h2 className="text-lg font-semibold uppercase tracking-tight text-white">
            Captain claims
          </h2>
          {!activeT ? (
            <p className="text-sm text-white/60">Activate a tournament to see captain claims.</p>
          ) : captainsErr ? (
            <p className="text-sm text-red-300">{captainsErr}</p>
          ) : captains.length === 0 ? (
            <p className="text-sm text-white/60">No captain rows for this tournament yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-left">Captain</th>
                    <th className="p-3 text-left">IG</th>
                    <th className="p-3 text-left">Team</th>
                    <th className="p-3 text-left">Exp.</th>
                    <th className="p-3 text-left">Verified</th>
                    <th className="p-3 text-left">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {captains.map((c) => (
                    <tr key={String(c.id)} className="border-b border-white/10 align-top">
                      <td className="p-3 text-white/80">{String(c.status || "—")}</td>
                      <td className="p-3 text-white/90">{String(c.captain_name || "—")}</td>
                      <td className="p-3 text-white/70">{String(c.captain_instagram || "—")}</td>
                      <td className="p-3 text-white/80">{String(c.team_name || "—")}</td>
                      <td className="p-3 text-white/70">
                        {c.expected_players != null ? String(c.expected_players) : "—"}
                      </td>
                      <td className="p-3 text-white/70">{c.captain_verified ? "Yes" : "No"}</td>
                      <td className="p-3 whitespace-nowrap text-white/60">
                        {fmtDate(c.claim_submitted_at as string)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Intake submissions */}
        <section className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-3xl font-semibold uppercase tracking-tight text-white">Submissions</div>
              <div className="text-white/70 text-sm">Tournament intake (latest 200)</div>
            </div>

            <div className="text-sm text-white/60">
              Filters:{" "}
              <a className="underline" href="/admin/tournament">
                All
              </a>{" "}
              ·{" "}
              <a className="underline" href="/admin/tournament?decision=pending">
                Pending
              </a>{" "}
              ·{" "}
              <a className="underline" href="/admin/tournament?decision=confirmed">
                Confirmed
              </a>{" "}
              ·{" "}
              <a className="underline" href="/admin/tournament?decision=standby">
                Standby
              </a>
            </div>
          </div>

          {subErr && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-white/80">
              Error: {subErr.message}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="text-white/70">
                <tr className="border-b border-white/10">
                  <th className="p-3 text-left">Created</th>
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-left">Age</th>
                  <th className="p-3 text-left">IG</th>
                  <th className="p-3 text-left">Phone</th>
                  <th className="p-3 text-left">Level</th>
                  <th className="p-3 text-left">Availability</th>
                  <th className="p-3 text-left">Review</th>
                </tr>
              </thead>
              <tbody>
                {(submissions || []).map((r) => (
                  <tr key={r.id} className="border-b border-white/10 align-top">
                    <td className="p-3 whitespace-nowrap text-white/70">{fmtDate(r.created_at)}</td>
                    <td className="p-3 font-semibold text-white/90">{r.full_name || "-"}</td>
                    <td className="p-3 text-white/80">{r.age ?? "-"}</td>
                    <td className="p-3 text-white/80">{r.instagram || "-"}</td>
                    <td className="p-3 text-white/80">{r.phone || "-"}</td>
                    <td className="p-3 text-white/80">{r.level || "-"}</td>
                    <td className="p-3 text-white/70 max-w-[200px]">
                      <div className="line-clamp-2">{r.availability || "-"}</div>
                    </td>
                    <td className="p-3">
                      <form action={updateTourneySubmission} className="space-y-2 min-w-[200px]">
                        <input type="hidden" name="submission_id" value={r.id} />
                        <select
                          name="decision"
                          defaultValue={(r.decision as string) || "pending"}
                          className="w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white"
                        >
                          <option value="pending">pending</option>
                          <option value="confirmed">confirmed</option>
                          <option value="standby">standby</option>
                          <option value="rejected">rejected</option>
                        </select>
                        <input
                          name="notes"
                          defaultValue={(r.notes as string) || ""}
                          placeholder="Notes"
                          className="w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35"
                        />
                        <label className="flex items-center gap-2 text-xs text-white/70">
                          <input
                            type="checkbox"
                            name="reviewed"
                            defaultChecked={!!r.reviewed}
                          />
                          Reviewed
                        </label>
                        <button
                          type="submit"
                          className="w-full rounded-md bg-white/90 px-2 py-1.5 text-xs font-semibold text-black"
                        >
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!submissions?.length && (
                  <tr>
                    <td className="p-6 text-white/60" colSpan={8}>
                      No submissions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
