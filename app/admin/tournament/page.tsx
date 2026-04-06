import PageTop from "@/components/PageTop";
import {
  OperatorLatestLine,
  OperatorLiveBar,
  OperatorNextSteps,
  OperatorQuickActions,
  OperatorWhereAppears,
} from "@/components/admin/operator/OperatorSections";
import { getTournamentOperatorContext } from "@/lib/admin/operatorContext";
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
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

type TourneyRow = Record<string, unknown> & {
  id: string;
  title?: string;
  slug?: string;
  is_active?: boolean;
  target_teams?: number;
  official_threshold?: number;
  max_teams?: number;
  staff_announcement?: string | null;
  staff_announcement_at?: string | null;
};

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
        <div className="mx-auto max-w-6xl pt-10 pb-10">
          <PageTop flush title="Staff · Tournaments" fallbackHref={APP_HOME_URL} />
          <p className="mt-6 text-white/80">Database isn’t configured for this environment.</p>
        </div>
      </main>
    );
  }

  const [{ data: tournaments, error: tListErr }, { data: activeT, error: activeErr }] = await Promise.all([
    supabase.from("tournaments").select("*").order("created_at", { ascending: false }),
    supabase.from("tournaments").select("*").eq("is_active", true).limit(1).maybeSingle(),
  ]);

  const active = activeT as TourneyRow | null;

  let captains: Record<string, unknown>[] = [];
  let captainsErr: string | null = null;
  if (active?.id) {
    const cRes = await supabase
      .from("tournament_captains")
      .select(
        "id,user_id,status,captain_name,captain_instagram,team_name,expected_players,captain_verified,claim_submitted_at,payment_due_at"
      )
      .eq("tournament_id", active.id)
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

  const opCtx = await getTournamentOperatorContext(
    supabase,
    active
      ? {
          id: active.id,
          title: active.title,
          staff_announcement: active.staff_announcement ?? null,
          staff_announcement_at: active.staff_announcement_at ?? null,
        }
      : null,
  );

  const nextSteps: string[] = [];
  if (!active) {
    nextSteps.push("Mark a tournament live so players see it on the tournament pages.");
  } else {
    const pend = (submissions || []).filter((s) => (s.decision as string) === "pending").length;
    if (pend) nextSteps.push(`${pend} signup(s) pending review.`);
    const hot = captains.filter((c) =>
      ["payment_pending", "claim_submitted", "roster_pending"].includes(String(c.status || "")),
    );
    if (hot.length) nextSteps.push(`${hot.length} captain claim(s) need follow-up.`);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-6 py-8">
        <PageTop flush title="Staff · Tournaments" fallbackHref={APP_HOME_URL} />

        {sp.ok ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {sp.ok === "active" && "Live tournament updated."}
            {sp.ok === "cleared" && "No tournament is live."}
            {sp.ok === "created" && "Tournament created."}
            {sp.ok === "saved" && "Submission saved."}
          </div>
        ) : null}
        {sp.e ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {sp.e}
          </div>
        ) : null}

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white">Live tournament</h2>
          <p className="text-sm text-white/70">
            The tournament marked Live is the one players currently see on the public tournament page and tournament hub.
          </p>
          {!active ? (
            <p className="text-sm text-white/55">
              No tournament is live right now, so players will not see a featured tournament.
            </p>
          ) : null}
        </section>

        <OperatorLiveBar
          label="Live on hub"
          title={active?.title || "—"}
          chip={active ? { tone: "published", text: "Live" } : { tone: "draft", text: "None" }}
          previewHref="/tournament"
        />

        {active ? (
          <div className="space-y-4">
            <OperatorQuickActions
              publishHref="/admin/publish?tournament=1"
              previewPaths={[
                { href: "/tournament", label: "Tournament hub" },
                { href: "/status/tournament", label: "Tournament status" },
              ]}
            />
            <OperatorLatestLine
              title="Live tournament announcement"
              body={opCtx.staffAnnouncement}
              at={opCtx.staffAnnouncementAt ? fmtDate(opCtx.staffAnnouncementAt as string) : null}
              empty="None yet — publish an update with the live tournament selected."
            />
            <OperatorWhereAppears rows={opCtx.whereRows} tablesMissing={opCtx.tablesMissing} />
            <OperatorNextSteps items={nextSteps} />
          </div>
        ) : (
          <OperatorNextSteps items={nextSteps} />
        )}

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-6">
          <div>
            <div className="text-sm font-semibold text-white">All tournaments</div>
            {activeErr ? <p className="mt-2 text-sm text-red-300">{activeErr.message}</p> : null}
            {tListErr ? <p className="mt-2 text-sm text-red-300">{tListErr.message}</p> : null}
            <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="p-2 text-left">Title</th>
                    <th className="p-2 text-left">URL name</th>
                    <th className="p-2 text-left">Target teams</th>
                    <th className="p-2 text-left">Teams for official status</th>
                    <th className="p-2 text-left">Maximum teams</th>
                    <th className="p-2 text-left">Live</th>
                    <th className="p-2 text-left" />
                  </tr>
                </thead>
                <tbody>
                  {(tournaments || []).length === 0 ? (
                    <tr>
                      <td className="p-4 text-white/50" colSpan={7}>
                        No tournaments yet. Create one below.
                      </td>
                    </tr>
                  ) : (
                    (tournaments as TourneyRow[]).map((t) => (
                      <tr key={t.id} className="border-b border-white/10 align-top">
                        <td className="p-2 text-white/90">{t.title}</td>
                        <td className="p-2 text-white/60">{t.slug || "—"}</td>
                        <td className="p-2 text-white/75">{t.target_teams ?? "—"}</td>
                        <td className="p-2 text-white/75">{t.official_threshold ?? "—"}</td>
                        <td className="p-2 text-white/75">{t.max_teams ?? "—"}</td>
                        <td className="p-2 text-white/75">{t.is_active ? "Live" : "Not live"}</td>
                        <td className="p-2">
                          {!t.is_active ? (
                            <form action={setActiveTournament}>
                              <input type="hidden" name="tournament_id" value={t.id} />
                              <button
                                type="submit"
                                className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-black"
                              >
                                Make live
                              </button>
                            </form>
                          ) : (
                            <form action={clearActiveTournament}>
                              <button
                                type="submit"
                                className="rounded-md border border-white/20 px-2 py-1 text-[11px] font-semibold text-white/85"
                              >
                                Take offline
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

          <div className="space-y-3 border-t border-white/10 pt-6">
            <div>
              <h3 className="text-sm font-semibold text-white">Create tournament</h3>
              <p className="mt-1 text-sm text-white/55">Create a new tournament draft. You can make it live later.</p>
            </div>
            <form action={createTournament} className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-white/80">Title</span>
                <input
                  name="title"
                  required
                  placeholder="Spring invitational"
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
                />
              </label>
              <div className="flex flex-col gap-1 text-sm sm:col-span-2">
                <label className="text-white/80" htmlFor="new-tournament-url-name">
                  URL name <span className="text-white/45">(optional)</span>
                </label>
                <input
                  id="new-tournament-url-name"
                  name="slug"
                  placeholder="next-tournament"
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35"
                />
                <p className="text-xs text-white/45">Used in the page link. Example: next-tournament</p>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-white/80">Target teams</span>
                <span className="text-xs text-white/45">How many teams you are planning toward.</span>
                <input
                  name="target_teams"
                  type="number"
                  min={1}
                  defaultValue={12}
                  required
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-white/80">Teams needed for official status</span>
                <span className="text-xs text-white/45">Once this many teams are confirmed, the tournament reads as official.</span>
                <input
                  name="official_threshold"
                  type="number"
                  min={1}
                  defaultValue={8}
                  required
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-white/80">Maximum teams</span>
                <span className="text-xs text-white/45">Cap on confirmed teams before the tournament is full.</span>
                <input
                  name="max_teams"
                  type="number"
                  min={1}
                  defaultValue={12}
                  required
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                />
              </label>
              <div className="flex items-end sm:col-span-2">
                <button type="submit" className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-black">
                  Create draft
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
          <div className="text-sm font-semibold text-white">Captain claims</div>
          {!active ? (
            <p className="text-sm text-white/55">Captain claims appear after a tournament is made live.</p>
          ) : captainsErr ? (
            <p className="text-sm text-red-300">{captainsErr}</p>
          ) : captains.length === 0 ? (
            <p className="text-sm text-white/50">No captain claims yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Captain</th>
                    <th className="p-2 text-left">Team</th>
                    <th className="p-2 text-left">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {captains.map((c) => (
                    <tr key={String(c.id)} className="border-b border-white/10">
                      <td className="p-2 text-white/80">{String(c.status || "—")}</td>
                      <td className="p-2 text-white/90">{String(c.captain_name || "—")}</td>
                      <td className="p-2 text-white/70">{String(c.team_name || "—")}</td>
                      <td className="p-2 whitespace-nowrap text-white/55">{fmtDate(c.claim_submitted_at as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Tournament signups</div>
              <p className="mt-0.5 text-xs text-white/50">Recent player signup submissions.</p>
            </div>
            <div className="text-xs text-white/50">
              <a className="underline" href="/admin/tournament">
                All
              </a>
              {" · "}
              <a className="underline" href="/admin/tournament?decision=pending">
                Pending
              </a>
              {" · "}
              <a className="underline" href="/admin/tournament?decision=confirmed">
                Confirmed
              </a>
              {" · "}
              <a className="underline" href="/admin/tournament?decision=standby">
                Standby
              </a>
            </div>
          </div>

          {subErr ? <p className="text-sm text-red-300">{subErr.message}</p> : null}

          <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03]">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-white/50">
                <tr className="border-b border-white/10">
                  <th className="p-2 text-left">Created</th>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">IG</th>
                  <th className="p-2 text-left">Review</th>
                </tr>
              </thead>
              <tbody>
                {(submissions || []).map((r) => (
                  <tr key={r.id} className="border-b border-white/10 align-top">
                    <td className="p-2 whitespace-nowrap text-white/60">{fmtDate(r.created_at)}</td>
                    <td className="p-2 font-medium text-white/90">{r.full_name || "—"}</td>
                    <td className="p-2 text-white/70">{r.instagram || "—"}</td>
                    <td className="p-2">
                      <form action={updateTourneySubmission} className="space-y-1 min-w-[160px]">
                        <input type="hidden" name="submission_id" value={r.id} />
                        <select
                          name="decision"
                          defaultValue={(r.decision as string) || "pending"}
                          className="w-full rounded border border-white/15 bg-black/50 px-2 py-1 text-xs text-white"
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
                          className="w-full rounded border border-white/15 bg-black/50 px-2 py-1 text-xs text-white"
                        />
                        <label className="flex items-center gap-1 text-[11px] text-white/60">
                          <input type="checkbox" name="reviewed" defaultChecked={!!r.reviewed} />
                          Reviewed
                        </label>
                        <button type="submit" className="w-full rounded bg-white/90 py-1 text-[11px] font-semibold text-black">
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!submissions?.length ? (
                  <tr>
                    <td className="p-4 text-white/50" colSpan={4}>
                      No signups yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
