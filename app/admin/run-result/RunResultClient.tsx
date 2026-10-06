"use client";

import Link from "next/link";
import PageTop from "@/components/PageTop";
import { SCORE_MAX, SCORE_MIN, winnerFromScore } from "@/lib/pickup/resultOutcome";
import { serviceRegionName, type ServiceRegionCode } from "@/lib/serviceRegions";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { useCallback, useEffect, useMemo, useState, startTransition } from "react";

type Team = "A" | "B" | "C";

type ConfirmedRow = { id: string; full_name: string | null; photo_package?: boolean };

function nameFor(p: ConfirmedRow) {
  const n = (p.full_name ?? "").trim();
  return n || p.id;
}

export default function RunResultClient({ runId }: { runId: string }) {
  const { supabase, isReady } = useSupabaseBrowser();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [region, setRegion] = useState<ServiceRegionCode | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedRow[]>([]);

  const [totalTeams, setTotalTeams] = useState<2 | 3>(2);
  const [winningTeam, setWinningTeam] = useState<Team | "draw">("A");
  const [tracked, setTracked] = useState(true);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [teamByUser, setTeamByUser] = useState<Record<string, Team>>({});

  const [playerOfDay, setPlayerOfDay] = useState<string>("");
  const [goalieOfTheDay, setGoalieOfTheDay] = useState<string>("");
  const [defenderOfDay, setDefenderOfDay] = useState<string>("");
  const [midfielderOfDay, setMidfielderOfDay] = useState<string>("");
  const [attackerOfDay, setAttackerOfDay] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !supabase) return;
    void (async () => {
      const s = await supabase.auth.getSession();
      setToken(s.data.session?.access_token || null);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, isReady]);

  const load = useCallback(async () => {
    if (!token || !runId) {
      setLoading(false);
      setErr(!token ? "Log in to record results." : "Missing run.");
      return;
    }
    setLoading(true);
    setErr(null);
    const r = await fetch(`/api/pickup/switch?run_id=${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setErr((j && (j as { error?: string }).error) || "Couldn’t load run.");
      setConfirmed([]);
      setLoading(false);
      return;
    }
    const run = (j as { run?: Record<string, unknown> }).run;
    const regionRaw = run && typeof run === "object" ? run.service_region : null;
    const reg = typeof regionRaw === "string" ? (regionRaw.trim().toUpperCase() as ServiceRegionCode) : null;
    setRegion(reg && ["CT", "NY", "NJ", "MD"].includes(reg) ? reg : null);
    const list = Array.isArray((j as { confirmed?: ConfirmedRow[] }).confirmed)
      ? ((j as { confirmed: ConfirmedRow[] }).confirmed ?? [])
      : [];
    setConfirmed(list);
    setTeamByUser((cur) => {
      if (Object.keys(cur).length) return cur;
      const next: Record<string, Team> = {};
      list.forEach((p, idx) => {
        next[p.id] = idx % 2 === 0 ? "A" : "B";
      });
      return next;
    });
    setLoading(false);
  }, [token, runId]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  const allowedTeams = useMemo<Team[]>(() => (totalTeams === 3 ? ["A", "B", "C"] : ["A", "B"]), [totalTeams]);

  const canScore = totalTeams === 2;
  const useScore = canScore && tracked;
  const winningTeamEffective: Team | "draw" =
    winningTeam === "draw" ? (canScore ? "draw" : "A") : allowedTeams.includes(winningTeam) ? winningTeam : "A";
  const parsedA = /^\d{1,2}$/.test(scoreA.trim()) ? Number(scoreA) : NaN;
  const parsedB = /^\d{1,2}$/.test(scoreB.trim()) ? Number(scoreB) : NaN;
  const scoreValid = [parsedA, parsedB].every((n) => Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX);
  const scoreWinner = scoreValid ? winnerFromScore(parsedA, parsedB) : undefined;

  const filledAssignments = useMemo(() => {
    return confirmed
      .map((p) => ({
        user_id: p.id,
        team: teamByUser[p.id] ?? "A",
      }))
      .filter((a) => allowedTeams.includes(a.team));
  }, [confirmed, teamByUser, allowedTeams]);

  const awardIds = [playerOfDay, goalieOfTheDay, defenderOfDay, midfielderOfDay, attackerOfDay].filter(Boolean);
  const awardWinnerNotInConfirmed = awardIds.some((id) => !confirmed.some((p) => p.id === id));

  async function onSubmit() {
    if (!token) return;
    setMsg(null);
    if (confirmed.length === 0) {
      setMsg("No confirmed players on this run.");
      return;
    }
    if (filledAssignments.length !== confirmed.length) {
      setMsg("Assign a team for each confirmed player.");
      return;
    }
    if (awardWinnerNotInConfirmed) {
      setMsg("Award winners must be from the confirmed roster (or leave blank).");
      return;
    }

    if (useScore && !scoreValid) {
      setMsg(`Enter both scores (${SCORE_MIN} to ${SCORE_MAX}), or tick "Didn't track the score".`);
      return;
    }

    setSubmitting(true);
    const outcomeFields = useScore
      ? { score_a: parsedA, score_b: parsedB }
      : winningTeamEffective === "draw"
        ? { outcome: "draw" }
        : { winning_team: winningTeamEffective };
    const r = await fetch("/api/admin/pickup/result", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        total_teams: totalTeams,
        ...outcomeFields,
        team_assignments: filledAssignments,
        player_of_day: playerOfDay || null,
        goalie_of_the_day: goalieOfTheDay || null,
        defender_of_day: defenderOfDay || null,
        midfielder_of_day: midfielderOfDay || null,
        attacker_of_day: attackerOfDay || null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setSubmitting(false);
    if (!r.ok) {
      setMsg((j as { error?: string }).error || "Couldn’t save result.");
      return;
    }
    setMsg("Saved. Players were notified.");
  }

  if (!token && isReady) {
    return (
      <main className="min-h-screen bg-canvas text-ink">
        <div className="mx-auto max-w-6xl pt-2">
          <PageTop flush title="Mark run result" fallbackHref={APP_HOME_URL} />
        </div>
        <div className="mx-auto max-w-2xl px-6 py-12 space-y-4">
          <p className="text-muted">Log in to continue.</p>
          <Link
            href={`/login?next=/admin/run-result?run_id=${encodeURIComponent(runId)}`}
            className="inline-flex rounded-button bg-pitch px-5 py-3 text-small font-semibold text-on-pitch"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-canvas text-ink flex items-center justify-center">
        <p className="text-muted text-small">Loading…</p>
      </main>
    );
  }

  if (err) {
    return (
      <main className="min-h-screen bg-canvas text-ink">
        <div className="mx-auto max-w-6xl pt-2">
          <PageTop flush title="Mark run result" fallbackHref="/admin/pickup" />
        </div>
        <div className="mx-auto max-w-2xl px-6 py-12">
          <p className="text-coral-text">{err}</p>
          <Link href="/admin/pickup" className="mt-6 inline-block text-pitch-text underline-offset-4 hover:underline">
            Back to pickups
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl pt-2">
        <PageTop flush title="Mark run result" fallbackHref="/admin/pickup" />
      </div>

      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-0">
        <div className="rounded-card border border-pitch-text bg-pitch-panel p-5">
          <p className="text-caption font-semibold text-muted">Run</p>
          <p className="mt-2 text-small text-muted">
            {region ? serviceRegionName(region) : "Region —"} · {confirmed.length} confirmed
          </p>
          <Link href="/admin/pickup" className="mt-3 inline-block text-small font-semibold text-pitch-text hover:underline">
            ← Pickup admin
          </Link>
        </div>

        {msg ? <p className="text-small text-muted">{msg}</p> : null}

        <section className="space-y-3">
          <p className="text-caption font-semibold text-muted">Teams</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTotalTeams(2);
                setWinningTeam("A");
              }}
              className={`flex-1 rounded-card border px-4 py-3 text-small font-semibold ${ totalTeams === 2 ? "border-pitch-text bg-pitch-panel text-on-pitch-panel" : "border-line bg-card text-muted" }`}
            >
              2 teams
            </button>
            <button
              type="button"
              onClick={() => {
                setTotalTeams(3);
                setWinningTeam("A");
              }}
              className={`flex-1 rounded-card border px-4 py-3 text-small font-semibold ${ totalTeams === 3 ? "border-pitch-text bg-pitch-panel text-on-pitch-panel" : "border-line bg-card text-muted" }`}
            >
              3 teams
            </button>
          </div>
        </section>

        <section className="space-y-2">
          {useScore ? (
            <>
              <p className="text-caption font-semibold text-muted">Final score</p>
              <div className="flex gap-3">
                {(
                  [
                    ["A", scoreA, setScoreA],
                    ["B", scoreB, setScoreB],
                  ] as const
                ).map(([team, val, setVal]) => (
                  <label key={team} className="flex-1 space-y-1">
                    <span className="text-caption font-semibold text-muted">Team {team}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={SCORE_MIN}
                      max={SCORE_MAX}
                      value={val}
                      onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                      className="w-full rounded-card border border-line bg-card px-4 py-3 text-center text-small text-ink"
                    />
                  </label>
                ))}
              </div>
              <p className="text-caption text-muted">
                {scoreWinner === undefined
                  ? `Scores from ${SCORE_MIN} to ${SCORE_MAX}. The higher score wins; equal is a draw.`
                  : scoreWinner
                    ? `Team ${scoreWinner} wins`
                    : "Draw"}
              </p>
            </>
          ) : (
            <>
              <label className="text-caption font-semibold text-muted">Winning team</label>
              <select
                value={winningTeamEffective}
                onChange={(e) => setWinningTeam(e.target.value as Team | "draw")}
                className="w-full rounded-card border border-line bg-card px-4 py-3 text-small text-ink"
              >
                {allowedTeams.map((t) => (
                  <option key={t} value={t}>
                    Team {t}
                  </option>
                ))}
                {canScore ? <option value="draw">Draw</option> : null}
              </select>
            </>
          )}
          {canScore ? (
            <label className="flex items-center gap-2 text-small text-ink">
              <input type="checkbox" checked={!tracked} onChange={(e) => setTracked(!e.target.checked)} />
              Didn&apos;t track the score
            </label>
          ) : null}
        </section>

        <section className="space-y-3">
          <p className="text-caption font-semibold text-muted">Roster</p>
          <div className="rounded-card border border-line bg-card p-4 space-y-3">
            {confirmed.length === 0 ? <p className="text-small text-muted">No confirmed players.</p> : null}
            {confirmed.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 flex items-center gap-2 truncate">
                  <span className="text-small font-semibold text-ink truncate">{nameFor(p)}</span>
                  {p.photo_package ? (
                    <span className="shrink-0 rounded-pill bg-pitch-panel border border-pitch-text px-2 py-0.5 text-caption font-semibold text-on-pitch-panel">
                      📸 Photos
                    </span>
                  ) : null}
                </div>
                <select
                  value={teamByUser[p.id] ?? "A"}
                  onChange={(e) =>
                    setTeamByUser((c) => ({ ...c, [p.id]: e.target.value as Team }))
                  }
                  className="rounded-pill border border-pitch-text bg-pitch-panel px-3 py-2 text-caption font-bold text-on-pitch-panel"
                >
                  {allowedTeams.map((t) => (
                    <option key={t} value={t}>
                      Team {t}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-caption font-semibold text-muted">Awards</p>
          <div className="rounded-card border border-line bg-card p-4 space-y-4">
            {(
              [
                ["player", "Player of the Day", playerOfDay, setPlayerOfDay],
                ["goalie", "Goalie of the Day", goalieOfTheDay, setGoalieOfTheDay],
                ["defender", "Defender of the Day", defenderOfDay, setDefenderOfDay],
                ["midfielder", "Midfielder of the Day", midfielderOfDay, setMidfielderOfDay],
                ["attacker", "Attacker of the Day", attackerOfDay, setAttackerOfDay],
              ] as const
            ).map(([key, label, val, setVal]) => (
              <label key={key} className="block space-y-1">
                <span className="text-caption font-semibold text-muted">{label}</span>
                <select
                  value={val}
                  onChange={(e) => setVal(e.target.value)}
                  className="w-full rounded-button border border-line bg-overlay-subtle px-3 py-2 text-small text-ink"
                >
                  <option value="">None</option>
                  {confirmed.map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameFor(p)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        <button
          type="button"
          disabled={submitting}
          onClick={() => void onSubmit()}
          className="w-full rounded-card bg-pitch py-3.5 text-small font-bold text-on-pitch disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Submit result"}
        </button>
      </div>
    </main>
  );
}
