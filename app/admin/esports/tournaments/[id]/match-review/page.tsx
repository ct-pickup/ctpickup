import Link from "next/link";
import PageTop from "@/components/PageTop";
import { StatusChip } from "@/components/admin/StatusChip";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";
import { fetchConductRollupForUsersInTournament } from "@/lib/esports/conductSummary";
import {
  staffFinalizeMatch,
  staffIssueConduct,
  staffResetMatchReport,
  staffUpdateTournamentMatchPolicies,
} from "./actions";

export const dynamic = "force-dynamic";

function fmtEt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return String(iso);
  }
}

export default async function AdminMatchReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const svc = supabaseService();

  const [{ data: t }, { data: matches }, { data: conduct }] = await Promise.all([
    svc
      .from("esports_tournaments")
      .select("id,title,match_confirmation_deadline_hours,require_match_proof,match_no_response_policy")
      .eq("id", id)
      .maybeSingle(),
    svc
      .from("esports_matches")
      .select(
        "id,stage_id,player1_user_id,player2_user_id,scheduled_deadline,status,score_player1,score_player2,winner_user_id,admin_notes_internal,finalized_at",
      )
      .eq("tournament_id", id)
      .in("status", ["awaiting_confirmation", "disputed", "under_review"])
      .order("updated_at", { ascending: false }),
    svc
      .from("esports_conduct_records")
      .select("id,user_id,severity,reason_category,created_at,match_id")
      .eq("tournament_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const tour = t as {
    title?: string;
    match_confirmation_deadline_hours?: number;
    require_match_proof?: boolean;
    match_no_response_policy?: string;
  } | null;

  const matchIds = (matches || []).map((m) => (m as { id: string }).id);
  const { data: reports } =
    matchIds.length > 0
      ? await svc.from("esports_match_reports").select("*").in("match_id", matchIds)
      : { data: [] };

  const reportById = new Map((reports || []).map((r: { match_id: string }) => [r.match_id, r]));

  const conductUserIds = [
    ...new Set(
      (matches || []).flatMap((m) => {
        const row = m as { player1_user_id: string; player2_user_id: string };
        return [row.player1_user_id, row.player2_user_id];
      }),
    ),
  ];
  const conductRollup = await fetchConductRollupForUsersInTournament(svc, id, conductUserIds);

  const { data: stages } = await svc
    .from("esports_tournament_stages")
    .select("id,name,type")
    .eq("tournament_id", id);
  const stageById = new Map((stages || []).map((s: { id: string }) => [s.id, s]));

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <PageTop flush title="Staff · Match review" fallbackHref={APP_HOME_URL} />
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/admin/esports/tournaments/${id}/engine`}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-white/85 transition hover:bg-white/[0.08]"
            >
              ← Tournament engine
            </Link>
            <a
              href={`/esports/tournaments/${id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/15 px-3 py-2 text-white/55 hover:text-white"
            >
              Public page ↗
            </a>
          </div>
        </div>

        {sp.ok ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            Saved ({sp.ok}).
          </div>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">{tour?.title ?? "Tournament"}</h2>
          <p className="mt-2 text-sm text-white/55">
            Defaults for this tournament: confirmation window, proof requirement, and what happens if the opponent
            never responds before the deadline.
          </p>
          <form action={staffUpdateTournamentMatchPolicies} className="mt-6 grid max-w-xl gap-3">
            <input type="hidden" name="tournament_id" value={id} />
            <label className="text-[11px] text-white/45">
              Hours to confirm after a report (1–336)
              <input
                name="match_confirmation_deadline_hours"
                type="number"
                min={1}
                max={336}
                defaultValue={tour?.match_confirmation_deadline_hours ?? 48}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-white/75">
              <input
                type="checkbox"
                name="require_match_proof"
                value="on"
                defaultChecked={Boolean(tour?.require_match_proof)}
                className="h-4 w-4 rounded border-white/30"
              />
              Require score screenshot before accepting a report
            </label>
            <label className="text-[11px] text-white/45">
              If the opponent does not respond before the deadline
              <select
                name="match_no_response_policy"
                defaultValue={tour?.match_no_response_policy === "auto_finalize_report" ? "auto_finalize_report" : "staff_review"}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm"
              >
                <option value="staff_review">Escalate to staff review (recommended)</option>
                <option value="auto_finalize_report">Auto-finalize using reporter’s score (use sparingly)</option>
              </select>
            </label>
            <button type="submit" className="w-fit rounded-md bg-white px-4 py-2 text-sm font-semibold text-black">
              Save tournament match rules
            </button>
          </form>
        </section>

        <datalist id="esports-conduct-reasons">
          <option value="false_report" />
          <option value="no_response" />
          <option value="refused_confirmation" />
          <option value="dispute_abuse" />
          <option value="suspicious_disconnect" />
          <option value="other" />
        </datalist>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">Conduct history (recent)</h2>
          {(conduct || []).length === 0 ? (
            <p className="mt-3 text-sm text-white/45">No conduct records for this tournament yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
              <table className="min-w-[900px] w-full border-collapse text-left text-[11px]">
                <thead className="border-b border-white/10 bg-[#121213] text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(conduct || []).map((c) => {
                    const row = c as {
                      id: string;
                      user_id: string;
                      severity: string;
                      reason_category: string | null;
                      created_at: string;
                      match_id: string | null;
                    };
                    return (
                      <tr key={row.id} className="text-white/75">
                        <td className="px-3 py-2 whitespace-nowrap">{fmtEt(row.created_at)}</td>
                        <td className="px-3 py-2 font-mono text-[10px]">{row.user_id}</td>
                        <td className="px-3 py-2">
                          <StatusChip tone="neutral">{row.severity}</StatusChip>
                        </td>
                        <td className="px-3 py-2">{row.reason_category ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-[10px]">{row.match_id ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">Open cases</h2>
          <p className="mt-2 text-sm text-white/55">
            Awaiting opponent confirmation, disputed results, or matches escalated after the confirmation deadline.
          </p>

          {(matches || []).length === 0 ? (
            <p className="mt-4 text-sm text-white/45">No matches need review right now.</p>
          ) : (
            <div className="mt-6 space-y-10">
              {(matches || []).map((raw) => {
                const m = raw as {
                  id: string;
                  stage_id: string;
                  player1_user_id: string;
                  player2_user_id: string;
                  scheduled_deadline: string | null;
                  status: string;
                  score_player1: number | null;
                  score_player2: number | null;
                  winner_user_id: string | null;
                  admin_notes_internal: string | null;
                  finalized_at: string | null;
                };
                const st = stageById.get(m.stage_id) as { name?: string; type?: string } | undefined;
                const rep = reportById.get(m.id) as
                  | {
                      reporter_user_id: string;
                      score_player1: number;
                      score_player2: number;
                      opponent_response: string;
                      dispute_reason: string | null;
                      screenshot_storage_path: string | null;
                      confirmation_deadline_at: string;
                      submitted_at: string;
                    }
                  | undefined;

                const proofHref = rep?.screenshot_storage_path
                  ? `/api/esports/matches/${m.id}/proof?path=${encodeURIComponent(rep.screenshot_storage_path)}`
                  : null;

                return (
                  <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={m.status === "under_review" ? "published" : "neutral"}>{m.status}</StatusChip>
                      <span className="text-xs text-white/45">{st?.name ?? "—"}</span>
                    </div>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Player 1</div>
                        <div className="mt-1 font-mono text-[11px] text-white/80">{m.player1_user_id}</div>
                        {(() => {
                          const r = conductRollup.get(m.player1_user_id);
                          return r ? (
                            <div className="mt-1 text-[10px] text-white/40">
                              This tournament: warnings {r.warnings} · strikes {r.strikes}
                              {r.severe > 0 ? ` · forfeit/DQ ${r.severe}` : ""}
                            </div>
                          ) : null;
                        })()}
                        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                          Player 2
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-white/80">{m.player2_user_id}</div>
                        {(() => {
                          const r = conductRollup.get(m.player2_user_id);
                          return r ? (
                            <div className="mt-1 text-[10px] text-white/40">
                              This tournament: warnings {r.warnings} · strikes {r.strikes}
                              {r.severe > 0 ? ` · forfeit/DQ ${r.severe}` : ""}
                            </div>
                          ) : null;
                        })()}
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Play deadline</div>
                        <div className="mt-1 text-sm text-white/75">{fmtEt(m.scheduled_deadline)}</div>
                        {rep ? (
                          <div className="mt-4 grid gap-3">
                            <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                                Reporter submission
                              </div>
                              <div className="mt-2 font-mono text-sm text-white">
                                Score (P1–P2): {rep.score_player1} – {rep.score_player2}
                              </div>
                              <div className="mt-1 text-[11px] text-white/50">
                                Submitted by {rep.reporter_user_id === m.player1_user_id ? "P1" : "P2"} ·{" "}
                                {fmtEt(rep.submitted_at)}
                              </div>
                              {proofHref ? (
                                <a
                                  href={proofHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-block text-sm text-[var(--brand)] underline-offset-4 hover:underline"
                                >
                                  Open screenshot
                                </a>
                              ) : (
                                <div className="mt-2 text-[11px] text-white/40">No screenshot on file.</div>
                              )}
                            </div>
                            <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Opponent</div>
                              <div className="mt-2 text-sm text-white/85">
                                {rep.opponent_response === "pending"
                                  ? "Awaiting confirmation"
                                  : rep.opponent_response === "confirmed"
                                    ? "Confirmed"
                                    : rep.opponent_response === "disputed"
                                      ? "Disputed"
                                      : rep.opponent_response === "timed_out"
                                        ? "No response (deadline; auto-finalize path)"
                                        : rep.opponent_response}
                              </div>
                              {rep.dispute_reason ? (
                                <div className="mt-2 text-[11px] text-rose-200/90">“{rep.dispute_reason}”</div>
                              ) : null}
                              <div className="mt-2 text-[11px] text-white/45">
                                Confirm by {fmtEt(rep.confirmation_deadline_at)}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-amber-200/80">No structured report row (legacy or cleared).</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">Finalize / adjust</h3>
                        <form action={staffFinalizeMatch} className="mt-3 grid gap-2">
                          <input type="hidden" name="tournament_id" value={id} />
                          <input type="hidden" name="match_id" value={m.id} />
                          <label className="text-[11px] text-white/45">
                            Status
                            <select
                              name="status"
                              defaultValue={m.status}
                              className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm"
                            >
                              <option value="scheduled">scheduled</option>
                              <option value="awaiting_confirmation">awaiting_confirmation</option>
                              <option value="disputed">disputed</option>
                              <option value="under_review">under_review</option>
                              <option value="completed">completed</option>
                              <option value="void">void</option>
                              <option value="forfeit">forfeit</option>
                            </select>
                          </label>
                          <label className="text-[11px] text-white/45">
                            Score P1
                            <input
                              name="score_player1"
                              defaultValue={typeof m.score_player1 === "number" ? String(m.score_player1) : ""}
                              className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm font-mono"
                            />
                          </label>
                          <label className="text-[11px] text-white/45">
                            Score P2
                            <input
                              name="score_player2"
                              defaultValue={typeof m.score_player2 === "number" ? String(m.score_player2) : ""}
                              className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm font-mono"
                            />
                          </label>
                          <label className="text-[11px] text-white/45">
                            Winner user id (optional; draws may be empty)
                            <input
                              name="winner_user_id"
                              defaultValue={m.winner_user_id ?? ""}
                              className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm font-mono"
                            />
                          </label>
                          <label className="text-[11px] text-white/45">
                            Internal notes
                            <textarea
                              name="admin_notes_internal"
                              rows={3}
                              defaultValue={m.admin_notes_internal ?? ""}
                              className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm"
                            />
                          </label>
                          <button
                            type="submit"
                            className="mt-2 w-fit rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
                          >
                            Save decision
                          </button>
                        </form>
                      </div>

                      <div className="space-y-6">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
                            Issue conduct action
                          </h3>
                          <form action={staffIssueConduct} className="mt-3 grid gap-2">
                            <input type="hidden" name="tournament_id" value={id} />
                            <input type="hidden" name="match_id" value={m.id} />
                            <label className="text-[11px] text-white/45">
                              Target user id
                              <input
                                name="user_id"
                                placeholder="UUID"
                                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm font-mono"
                                required
                              />
                            </label>
                            <label className="text-[11px] text-white/45">
                              Severity
                              <select name="severity" className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm">
                                <option value="warning">warning</option>
                                <option value="strike">strike</option>
                                <option value="forfeit">forfeit</option>
                                <option value="disqualification">disqualification</option>
                              </select>
                            </label>
                            <label className="text-[11px] text-white/45">
                              Category (optional)
                              <input
                                name="reason_category"
                                list="esports-conduct-reasons"
                                placeholder="Pick or type"
                                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm"
                              />
                            </label>
                            <label className="text-[11px] text-white/45">
                              Notes (internal)
                              <textarea name="notes_internal" rows={3} className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-2 text-sm" />
                            </label>
                            <button
                              type="submit"
                              className="mt-2 w-fit rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white/90"
                            >
                              Record conduct
                            </button>
                          </form>
                        </div>

                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
                            Reset for new player report
                          </h3>
                          <p className="mt-2 text-[11px] text-white/45">
                            Clears the structured report row and returns the match to scheduled (use after a bad dispute
                            or bad submission).
                          </p>
                          <form action={staffResetMatchReport} className="mt-3">
                            <input type="hidden" name="tournament_id" value={id} />
                            <input type="hidden" name="match_id" value={m.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-rose-500/40 px-4 py-2 text-sm font-semibold text-rose-100/90"
                            >
                              Reset match report
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
