"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { matchWorkflowUiLabel } from "@/lib/esports/matchWorkflowCore";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

export type PlayEntry = {
  matchId: string;
  stageType: string;
  stageName: string;
  opponentLabel: string;
  scheduledDeadlineIso: string | null;
  youArePlayer1: boolean;
  /** Whether the current user submitted the pending report (if any). */
  reporterIsYou: boolean;
  status: EsportsMatchWorkflowStatus;
  scorePlayer1: number | null;
  scorePlayer2: number | null;
  winnerUserId: string | null;
  report: EsportsMatchReportRow | null;
};

type Props = {
  entries: PlayEntry[];
  /** Tournament requires an uploaded screenshot before a result report is accepted. */
  requireMatchProof: boolean;
};

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return "Deadline passed";
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m ${secs}s`;
}

function badgeClasses(ui: ReturnType<typeof matchWorkflowUiLabel>): string {
  switch (ui) {
    case "finalized":
    case "confirmed":
      return "border-emerald-400/40 bg-emerald-500/15 text-emerald-100";
    case "awaiting_confirmation":
      return "border-amber-400/40 bg-amber-500/15 text-amber-100";
    case "disputed":
    case "under_review":
      return "border-rose-400/40 bg-rose-500/15 text-rose-100";
    case "forfeit":
      return "border-orange-400/40 bg-orange-500/15 text-orange-100";
    case "void":
      return "border-white/20 bg-white/[0.06] text-white/55";
    default:
      return "border-white/15 bg-white/[0.06] text-white/70";
  }
}

function uiTitle(ui: ReturnType<typeof matchWorkflowUiLabel>): string {
  switch (ui) {
    case "awaiting_report":
      return "Awaiting Report";
    case "awaiting_confirmation":
      return "Awaiting Confirmation";
    case "finalized":
    case "confirmed":
      return "Finalized";
    case "disputed":
      return "Disputed";
    case "under_review":
      return "Under Review";
    case "forfeit":
      return "Forfeit";
    case "void":
      return "Void";
    default:
      return ui;
  }
}

export function EsportsTournamentPlayClient({ entries, requireMatchProof }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [scoreYou, setScoreYou] = useState("");
  const [scoreOpp, setScoreOpp] = useState("");
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sorted = useMemo(() => {
    const priority: Record<string, number> = {
      scheduled: 0,
      awaiting_confirmation: 1,
      disputed: 2,
      under_review: 3,
      completed: 4,
      forfeit: 4,
      void: 5,
    };
    return [...entries].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  }, [entries]);

  async function uploadProof(matchId: string, file: File) {
    setBusyId(matchId);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await fetch(`/api/esports/matches/${matchId}/proof-upload`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Upload failed.");
        return;
      }
      setProofPath(typeof j?.screenshot_storage_path === "string" ? j.screenshot_storage_path : null);
      setMsg("Screenshot uploaded. Submit the result to attach it.");
    } catch {
      setMsg("Upload failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitReport(matchId: string, youArePlayer1: boolean) {
    setBusyId(matchId);
    setMsg(null);
    try {
      const sYou = scoreYou.trim() === "" ? null : Number(scoreYou.trim());
      const sOpp = scoreOpp.trim() === "" ? null : Number(scoreOpp.trim());
      if (sYou == null || sOpp == null) {
        setMsg("Enter both scores.");
        return;
      }
      if (!Number.isInteger(sYou) || sYou < 0 || !Number.isInteger(sOpp) || sOpp < 0) {
        setMsg("Scores must be non-negative integers.");
        return;
      }

      const body = youArePlayer1
        ? { score_player1: sYou, score_player2: sOpp, screenshot_storage_path: proofPath }
        : { score_player1: sOpp, score_player2: sYou, screenshot_storage_path: proofPath };

      const r = await fetch(`/api/esports/matches/${matchId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not submit report.");
        return;
      }
      setMsg("Report submitted. Your opponent must confirm.");
      setOpenReportId(null);
      setProofPath(null);
      setScoreYou("");
      setScoreOpp("");
      router.refresh();
    } catch {
      setMsg("Could not submit report.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmResult(matchId: string) {
    setBusyId(matchId);
    setMsg(null);
    try {
      const r = await fetch(`/api/esports/matches/${matchId}/confirm`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not confirm.");
        return;
      }
      setMsg("Result confirmed. The match is now official.");
      router.refresh();
    } catch {
      setMsg("Could not confirm.");
    } finally {
      setBusyId(null);
    }
  }

  async function disputeResult(matchId: string) {
    setBusyId(matchId);
    setMsg(null);
    try {
      const r = await fetch(`/api/esports/matches/${matchId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: disputeReason.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not dispute.");
        return;
      }
      setMsg("Dispute recorded. Staff will review.");
      setDisputeReason("");
      router.refresh();
    } catch {
      setMsg("Could not dispute.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {msg ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/85">{msg}</div>
      ) : null}

      {sorted.map((e) => {
        const ui = matchWorkflowUiLabel({ status: e.status, report: e.report });
        const deadlineMs = e.scheduledDeadlineIso ? Date.parse(e.scheduledDeadlineIso) : null;
        const msLeft = deadlineMs == null ? null : deadlineMs - now;
        const isUnder24h = typeof msLeft === "number" && msLeft > 0 && msLeft <= 24 * 60 * 60 * 1000;

        const youScore = e.youArePlayer1 ? e.scorePlayer1 : e.scorePlayer2;
        const oppScore = e.youArePlayer1 ? e.scorePlayer2 : e.scorePlayer1;

        const canReport =
          e.status !== "void" &&
          e.status !== "completed" &&
          (e.status === "scheduled" ||
            (e.status === "awaiting_confirmation" && e.report?.opponent_response === "pending" && e.reporterIsYou));

        const showOpponentPanel =
          e.status === "awaiting_confirmation" &&
          e.report &&
          e.report.opponent_response === "pending" &&
          !e.reporterIsYou;

        const busy = busyId === e.matchId;

        return (
          <div
            key={e.matchId}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-white/55">
                    {e.stageType === "group_stage" ? "Group stage" : "Knockout"}
                  </div>
                  <div className="text-xs text-white/35">·</div>
                  <div className="text-xs text-white/65">{e.stageName}</div>
                </div>
                <h2 className="mt-3 text-lg font-semibold text-white">vs {e.opponentLabel}</h2>
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${badgeClasses(ui)}`}
              >
                {uiTitle(ui)}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/55">Play-by deadline</div>
                <div className="mt-2 text-sm text-white/80">{e.scheduledDeadlineIso ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/55">Countdown</div>
                <div className={`mt-2 text-sm ${isUnder24h ? "text-amber-200" : "text-white/80"}`}>
                  {msLeft == null ? "—" : fmtCountdown(msLeft)}
                </div>
                {isUnder24h ? <div className="mt-1 text-[11px] text-white/45">Under 24 hours left.</div> : null}
              </div>
            </div>

            {e.status === "completed" || e.status === "forfeit" ? (
              <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/80">
                <div>
                  Score:{" "}
                  <span className="text-white">
                    {typeof youScore === "number" && typeof oppScore === "number"
                      ? `${youScore}–${oppScore} (you–opp)`
                      : "—"}
                  </span>
                </div>
                {e.winnerUserId ? (
                  <div className="mt-2 text-white/60">
                    Outcome recorded for bracket standings (winner id on file).
                  </div>
                ) : null}
              </div>
            ) : null}

            {e.report?.screenshot_storage_path ? (
              <div className="mt-4 text-xs text-white/55">
                Proof on file.{" "}
                <a
                  className="text-[var(--brand)] underline-offset-4 hover:underline"
                  href={`/api/esports/matches/${e.matchId}/proof?path=${encodeURIComponent(e.report.screenshot_storage_path)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View screenshot
                </a>
              </div>
            ) : null}

            {e.report && e.status !== "completed" && e.status !== "void" ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/75">
                <div className="font-semibold text-white/90">Reported score (P1–P2)</div>
                <div className="mt-1 font-mono text-white">
                  {e.report.score_player1} – {e.report.score_player2}
                </div>
                {e.report.confirmation_deadline_at ? (
                  <div className="mt-2 text-xs text-white/50">
                    Confirmation due by {new Date(e.report.confirmation_deadline_at).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ) : null}

            {showOpponentPanel ? (
              <div className="mt-6 space-y-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                <p className="text-sm text-amber-100/90">
                  Your opponent reported a result. Please confirm if it matches your final score screen, or dispute if
                  it does not.
                </p>
                <label className="block text-xs text-white/55">
                  Dispute note (optional)
                  <textarea
                    value={disputeReason}
                    onChange={(ev) => setDisputeReason(ev.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                    disabled={busy}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmResult(e.matchId)}
                    className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    Confirm result
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disputeResult(e.matchId)}
                    className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 disabled:opacity-40"
                  >
                    Dispute
                  </button>
                </div>
              </div>
            ) : null}

            {canReport ? (
              <div className="mt-6 space-y-4">
                <p className="text-sm text-white/60">
                  Keep a screenshot of the final score screen. Upload it here, then submit the score you believe is
                  correct.
                  {requireMatchProof ? (
                    <span className="block pt-1 text-amber-200/90">Screenshot upload is required before you can submit.</span>
                  ) : null}
                </p>
                <label className="block text-xs text-white/55">
                  Screenshot (JPEG, PNG, or WebP, max 5MB)
                  {requireMatchProof ? " — required" : ""}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    className="mt-1 block w-full text-sm text-white/80 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) void uploadProof(e.matchId, f);
                    }}
                  />
                </label>
                {proofPath ? <div className="text-xs text-emerald-200/90">Ready to attach: {proofPath}</div> : null}

                {openReportId === e.matchId ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Your score
                      <input
                        value={scoreYou}
                        onChange={(ev) => setScoreYou(ev.target.value)}
                        inputMode="numeric"
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                        placeholder="0"
                        disabled={busy}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-white/55">
                      Opponent score
                      <input
                        value={scoreOpp}
                        onChange={(ev) => setScoreOpp(ev.target.value)}
                        inputMode="numeric"
                        className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                        placeholder="0"
                        disabled={busy}
                      />
                    </label>
                    <div className="sm:col-span-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitReport(e.matchId, e.youArePlayer1)}
                        className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                      >
                        Submit result
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setOpenReportId(null);
                          setScoreYou("");
                          setScoreOpp("");
                        }}
                        className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/75"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setOpenReportId(e.matchId);
                      setProofPath(e.report?.screenshot_storage_path ?? null);
                      setScoreYou("");
                      setScoreOpp("");
                    }}
                    className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    {e.status === "awaiting_confirmation" && e.reporterIsYou ? "Update report" : "Report result"}
                  </button>
                )}
              </div>
            ) : null}

            {(e.status === "disputed" || e.status === "under_review") && (
              <p className="mt-5 text-sm text-white/55">
                Staff are reviewing this match. You will be contacted if more information is needed.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
