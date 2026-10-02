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
      return "border-pitch bg-pitch-soft text-pitch";
    case "awaiting_confirmation":
      return "border-coral bg-overlay-subtle text-coral";
    case "disputed":
    case "under_review":
      return "border-coral bg-overlay-subtle text-coral";
    case "forfeit":
      return "border-coral bg-overlay-subtle text-coral";
    case "void":
      return "border-line bg-overlay text-muted";
    default:
      return "border-line bg-overlay text-muted";
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
        <div className="rounded-card border border-line bg-overlay-subtle px-4 py-3 text-small text-ink">{msg}</div>
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
            className="rounded-card border border-line bg-overlay-subtle p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-caption font-semibold text-muted">
                    {e.stageType === "group_stage" ? "Group stage" : "Knockout"}
                  </div>
                  <div className="text-caption text-muted">·</div>
                  <div className="text-caption text-muted">{e.stageName}</div>
                </div>
                <h2 className="mt-3 text-h3 font-serif font-semibold text-ink">vs {e.opponentLabel}</h2>
              </div>
              <span
                className={`inline-flex items-center rounded-pill border px-3 py-1 text-caption font-semibold${badgeClasses(ui)}`}
              >
                {uiTitle(ui)}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-card border border-line bg-overlay-subtle p-4">
                <div className="text-caption font-semibold text-muted">Play-by deadline</div>
                <div className="mt-2 text-small text-ink">{e.scheduledDeadlineIso ?? "—"}</div>
              </div>
              <div className="rounded-card border border-line bg-overlay-subtle p-4">
                <div className="text-caption font-semibold text-muted">Countdown</div>
                <div className={`mt-2 text-small ${isUnder24h ? "text-coral" : "text-ink"}`}>
                  {msLeft == null ? "—" : fmtCountdown(msLeft)}
                </div>
                {isUnder24h ? <div className="mt-1 text-caption text-muted">Under 24 hours left.</div> : null}
              </div>
            </div>

            {e.status === "completed" || e.status === "forfeit" ? (
              <div className="mt-5 rounded-card border border-line bg-overlay-strong p-4 text-small text-ink">
                <div>
                  Score:{"  "}
                  <span className="text-ink">
                    {typeof youScore === "number" && typeof oppScore === "number"
                      ? `${youScore}–${oppScore} (you–opp)`
                      : "—"}
                  </span>
                </div>
                {e.winnerUserId ? (
                  <div className="mt-2 text-muted">
                    Outcome recorded for bracket standings (winner id on file).
                  </div>
                ) : null}
              </div>
            ) : null}

            {e.report?.screenshot_storage_path ? (
              <div className="mt-4 text-caption text-muted">
                Proof on file.{"  "}
                <a
                  className="text-pitch-text underline-offset-4 hover:underline"
                  href={`/api/esports/matches/${e.matchId}/proof?path=${encodeURIComponent(e.report.screenshot_storage_path)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View screenshot
                </a>
              </div>
            ) : null}

            {e.report && e.status !== "completed" && e.status !== "void" ? (
              <div className="mt-4 rounded-card border border-line bg-overlay-strong p-4 text-small text-muted">
                <div className="font-semibold text-ink">Reported score (P1–P2)</div>
                <div className="mt-1 font-mono text-ink">
                  {e.report.score_player1} – {e.report.score_player2}
                </div>
                {e.report.confirmation_deadline_at ? (
                  <div className="mt-2 text-caption text-muted">
                    Confirmation due by {new Date(e.report.confirmation_deadline_at).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ) : null}

            {showOpponentPanel ? (
              <div className="mt-6 space-y-4 rounded-card border border-coral bg-overlay-subtle p-4">
                <p className="text-small text-coral">
                  Your opponent reported a result. Please confirm if it matches your final score screen, or dispute if
                  it does not.
                </p>
                <label className="block text-caption text-muted">
                  Dispute note (optional)
                  <textarea
                    value={disputeReason}
                    onChange={(ev) => setDisputeReason(ev.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
                    disabled={busy}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmResult(e.matchId)}
                    className="rounded-button bg-pitch px-4 py-2 text-small font-semibold text-on-pitch disabled:opacity-40"
                  >
                    Confirm result
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disputeResult(e.matchId)}
                    className="rounded-button border border-line px-4 py-2 text-small font-semibold text-ink disabled:opacity-40"
                  >
                    Dispute
                  </button>
                </div>
              </div>
            ) : null}

            {canReport ? (
              <div className="mt-6 space-y-4">
                <p className="text-small text-muted">
                  Keep a screenshot of the final score screen. Upload it here, then submit the score you believe is
                  correct.
                  {requireMatchProof ? (
                    <span className="block pt-1 text-coral">Screenshot upload is required before you can submit.</span>
                  ) : null}
                </p>
                <label className="block text-caption text-muted">
                  Screenshot (JPEG, PNG, or WebP, max 5MB)
                  {requireMatchProof ? " — required" : ""}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    className="mt-1 block w-full text-small text-ink file:mr-3 file:rounded-button file:border-0 file:bg-pitch file:px-3 file:py-1.5 file:text-small file:font-semibold file:text-on-pitch"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) void uploadProof(e.matchId, f);
                    }}
                  />
                </label>
                {proofPath ? <div className="text-caption text-pitch-text">Ready to attach: {proofPath}</div> : null}

                {openReportId === e.matchId ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-caption text-muted">
                      Your score
                      <input
                        value={scoreYou}
                        onChange={(ev) => setScoreYou(ev.target.value)}
                        inputMode="numeric"
                        className="rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
                        placeholder="0"
                        disabled={busy}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption text-muted">
                      Opponent score
                      <input
                        value={scoreOpp}
                        onChange={(ev) => setScoreOpp(ev.target.value)}
                        inputMode="numeric"
                        className="rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
                        placeholder="0"
                        disabled={busy}
                      />
                    </label>
                    <div className="sm:col-span-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitReport(e.matchId, e.youArePlayer1)}
                        className="rounded-button bg-pitch px-4 py-2 text-small font-semibold text-on-pitch disabled:opacity-40"
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
                        className="rounded-button border border-line px-4 py-2 text-small text-muted"
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
                    className="rounded-button bg-pitch px-4 py-2 text-small font-semibold text-on-pitch disabled:opacity-40"
                  >
                    {e.status === "awaiting_confirmation" && e.reporterIsYou ? "Update report" : "Report result"}
                  </button>
                )}
              </div>
            ) : null}

            {(e.status === "disputed" || e.status === "under_review") && (
              <p className="mt-5 text-small text-muted">
                Staff are reviewing this match. You will be contacted if more information is needed.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
