"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  matchId: string;
  stageType: string;
  stageName: string;
  opponentLabel: string;
  scheduledDeadlineIso: string | null;
  youArePlayer1: boolean;
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

export function EsportsTournamentPlayClient({
  matchId,
  stageType,
  stageName,
  opponentLabel,
  scheduledDeadlineIso,
  youArePlayer1,
}: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [scoreYou, setScoreYou] = useState("");
  const [scoreOpp, setScoreOpp] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const deadlineMs = useMemo(() => (scheduledDeadlineIso ? Date.parse(scheduledDeadlineIso) : null), [scheduledDeadlineIso]);
  const msLeft = deadlineMs == null ? null : deadlineMs - now;
  const isUnder24h = typeof msLeft === "number" && msLeft > 0 && msLeft <= 24 * 60 * 60 * 1000;

  async function submitReport() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const sYou = scoreYou.trim() === "" ? null : Number(scoreYou.trim());
      const sOpp = scoreOpp.trim() === "" ? null : Number(scoreOpp.trim());
      if (sYou == null || sOpp == null) {
        setMsg("Enter both scores.");
        setBusy(false);
        return;
      }
      if (!Number.isInteger(sYou) || sYou < 0 || !Number.isInteger(sOpp) || sOpp < 0) {
        setMsg("Scores must be non-negative integers.");
        setBusy(false);
        return;
      }

      const body = youArePlayer1
        ? { score_player1: sYou, score_player2: sOpp, proof_url: proofUrl.trim() || null }
        : { score_player1: sOpp, score_player2: sYou, proof_url: proofUrl.trim() || null };

      const r = await fetch(`/api/esports/matches/${matchId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(typeof j?.error === "string" ? j.error : "Could not submit report.");
        setBusy(false);
        return;
      }
      setMsg("Report submitted. Admin will confirm the result.");
      router.refresh();
    } catch {
      setMsg("Could not submit report.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/55">
            {stageType === "group_stage" ? "Group stage" : "Knockout"}
          </div>
          <div className="text-xs text-white/35">·</div>
          <div className="text-xs text-white/65">{stageName}</div>
        </div>

        <h2 className="mt-3 text-lg font-semibold text-white">Your opponent</h2>
        <p className="mt-2 text-sm text-white/75">{opponentLabel}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/55">Must complete by</div>
            <div className="mt-2 text-sm text-white/80">{scheduledDeadlineIso ?? "—"}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/55">Countdown</div>
            <div className={`mt-2 text-sm ${isUnder24h ? "text-amber-200" : "text-white/80"}`}>
              {msLeft == null ? "—" : fmtCountdown(msLeft)}
            </div>
            {isUnder24h ? (
              <div className="mt-1 text-[11px] text-white/45">Under 24 hours left.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Report score</h2>
        <p className="mt-2 text-sm text-white/55">
          Submit the final score and optional proof. Staff will confirm and advance the bracket.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-white/55">
            Your score
            <input
              value={scoreYou}
              onChange={(e) => setScoreYou(e.target.value)}
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
              onChange={(e) => setScoreOpp(e.target.value)}
              inputMode="numeric"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="0"
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/55 sm:col-span-2">
            Proof URL (optional)
            <input
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder="Link to screenshot/video"
              disabled={busy}
            />
          </label>
        </div>

        {msg ? <p className="mt-3 text-sm text-white/80">{msg}</p> : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void submitReport()}
            disabled={busy}
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "Submitting…" : "Submit result"}
          </button>
        </div>
      </div>
    </div>
  );
}

