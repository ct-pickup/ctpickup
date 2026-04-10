import Link from "next/link";
import PageTop from "@/components/PageTop";
import { StatusChip } from "@/components/admin/StatusChip";
import { APP_HOME_URL } from "@/lib/siteNav";
import { supabaseService } from "@/lib/supabase/service";
import {
  generateGroupStage,
  generateKnockoutFromGroups,
  generateNextKnockoutRound,
  lockGroupStage,
  lockKnockoutStage,
  updateMatchAdmin,
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

type TournamentRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: string;
};

export default async function AdminTournamentEnginePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; e?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const svc = supabaseService();

  const [{ data: t, error: tErr }, { data: stages }, { data: matches }, { data: regs }] =
    await Promise.all([
      svc
        .from("esports_tournaments")
        .select("id,title,start_date,end_date,status")
        .eq("id", id)
        .maybeSingle(),
      svc
        .from("esports_tournament_stages")
        .select("id,type,name,status,order_index,starts_at,ends_at,created_at")
        .eq("tournament_id", id)
        .order("order_index", { ascending: true }),
      svc
        .from("esports_matches")
        .select("id,stage_id,group_id,player1_user_id,player2_user_id,scheduled_deadline,status,winner_user_id,score_player1,score_player2,round_label,bracket_slot,updated_at")
        .eq("tournament_id", id)
        .order("scheduled_deadline", { ascending: true }),
      svc
        .from("esports_tournament_registrations")
        .select("id")
        .eq("tournament_id", id)
        .eq("payment_status", "paid"),
    ]);

  const tour = t as TournamentRow | null;
  const paidCount = regs?.length ?? 0;
  const stageList = (stages || []) as Array<{
    id: string;
    type: string;
    name: string;
    status: string;
    order_index: number;
    starts_at: string | null;
    ends_at: string | null;
    created_at: string;
  }>;
  const matchList = (matches || []) as Array<{
    id: string;
    stage_id: string;
    group_id: string | null;
    player1_user_id: string;
    player2_user_id: string;
    scheduled_deadline: string | null;
    status: string;
    winner_user_id: string | null;
    score_player1: number | null;
    score_player2: number | null;
    round_label: string | null;
    bracket_slot: number | null;
    updated_at: string;
  }>;

  const stageById = new Map(stageList.map((s) => [s.id, s]));
  const stageTypeCounts = stageList.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const base = new Date();
  function daysFromNow(days: number) {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }
  const defaultMonday = daysFromNow(1);
  const defaultTuesday = daysFromNow(2);
  const defaultWednesday = daysFromNow(3);
  const defaultThursday = daysFromNow(4);
  const defaultFriday = daysFromNow(5);
  const defaultSaturday = daysFromNow(6);
  const defaultSunday = daysFromNow(7);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <PageTop
            flush
            title="Staff · Tournament engine"
            fallbackHref={APP_HOME_URL}
          />
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/admin/esports"
              className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-white/85 transition hover:bg-white/[0.08]"
            >
              ← Tournament admin
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
            {sp.ok === "group_stage_generated" && "Group stage generated."}
            {sp.ok === "group_stage_locked" && "Group stage locked."}
            {sp.ok === "knockout_generated" && "Knockout bracket generated (first knockout round)." }
            {sp.ok === "next_round_generated" && "Next knockout round generated."}
            {sp.ok === "stage_locked" && "Stage locked."}
            {sp.ok === "match_updated" && "Match updated."}
          </div>
        ) : null}
        {sp.e ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {sp.e}
          </div>
        ) : null}

        {tErr ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {tErr.message}
          </div>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{tour?.title ?? "Tournament"}</h2>
            <StatusChip tone="neutral">{tour?.status ?? "—"}</StatusChip>
            <StatusChip tone="published">{paidCount} paid players</StatusChip>
            <StatusChip tone="neutral">{matchList.length} matches</StatusChip>
          </div>
          <p className="mt-2 text-sm text-white/60">
            Window: {fmtEt(tour?.start_date)} → {fmtEt(tour?.end_date)}
          </p>
          <p className="mt-3 text-xs text-white/45">
            Stages:{" "}
            {Object.keys(stageTypeCounts).length
              ? Object.entries(stageTypeCounts)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" · ")
              : "—"}
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">
            Generate group stage (Mon/Tue/Wed deadlines)
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Uses paid registrations only. Creates groups, then round-robin matches. Round 1 due Monday, Round 2 due Tuesday,
            and all remaining rounds due Wednesday (11:59 PM ET recommended).
          </p>

          <form action={generateGroupStage} className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="tournament_id" value={id} />
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Group size
              <input
                name="group_size"
                required
                defaultValue={4}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Monday deadline (ISO)
              <input
                name="deadline_monday"
                required
                defaultValue={defaultMonday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Tuesday deadline (ISO)
              <input
                name="deadline_tuesday"
                required
                defaultValue={defaultTuesday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Wednesday deadline (ISO)
              <input
                name="deadline_wednesday"
                required
                defaultValue={defaultWednesday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="md:col-span-2 lg:col-span-3 flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                Generate group stage
              </button>
            </div>
          </form>

          <form action={lockGroupStage} className="mt-4">
            <input type="hidden" name="tournament_id" value={id} />
            <button
              type="submit"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
            >
              Lock group stage
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">
            Knockout bracket (Thu/Fri/Sat/Sun deadlines)
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Workflow: lock group stage → generate first knockout round → lock that stage → generate next round (repeat)
            until the final.
          </p>

          <form action={generateKnockoutFromGroups} className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="tournament_id" value={id} />
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Advance per group
              <input
                name="advance_per_group"
                required
                defaultValue={2}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Thursday deadline (ISO)
              <input
                name="deadline_thursday"
                required
                defaultValue={defaultThursday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Friday deadline (ISO)
              <input
                name="deadline_friday"
                required
                defaultValue={defaultFriday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Saturday deadline (ISO)
              <input
                name="deadline_saturday"
                required
                defaultValue={defaultSaturday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55 lg:col-span-2">
              Sunday final deadline (ISO)
              <input
                name="deadline_sunday"
                required
                defaultValue={defaultSunday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="md:col-span-2 lg:col-span-4 flex flex-wrap gap-2">
              <button type="submit" className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black">
                Generate first knockout round
              </button>
            </div>
          </form>

          <form action={generateNextKnockoutRound} className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="tournament_id" value={id} />
            <input type="hidden" name="deadline_thursday" value={defaultThursday} />
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Friday deadline (ISO)
              <input
                name="deadline_friday"
                required
                defaultValue={defaultFriday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55">
              Saturday deadline (ISO)
              <input
                name="deadline_saturday"
                required
                defaultValue={defaultSaturday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/55 lg:col-span-2">
              Sunday final deadline (ISO)
              <input
                name="deadline_sunday"
                required
                defaultValue={defaultSunday}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="md:col-span-2 lg:col-span-4 flex flex-wrap gap-2">
              <button type="submit" className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]">
                Generate next knockout round from winners
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">Stages</h2>
          {stageList.length === 0 ? (
            <p className="mt-3 text-sm text-white/55">No stages yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {stageList.map((s) => (
                <div key={s.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-white">
                      {s.order_index}. {s.name}
                    </div>
                    <StatusChip tone="neutral">{s.type}</StatusChip>
                    <StatusChip tone={s.status === "active" ? "published" : "neutral"}>{s.status}</StatusChip>
                  </div>
                  <p className="mt-2 text-xs text-white/45">
                    Starts {fmtEt(s.starts_at)} · Ends {fmtEt(s.ends_at)} · Created {fmtEt(s.created_at)}
                  </p>
                  {s.type !== "group_stage" ? (
                    <form action={lockKnockoutStage} className="mt-3">
                      <input type="hidden" name="tournament_id" value={id} />
                      <input type="hidden" name="stage_id" value={s.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/[0.06]"
                      >
                        Lock this stage
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">Matches (admin edits)</h2>
          <p className="mt-2 text-sm text-white/55">
            Use this for urgent fixes (pairings, deadlines, scores, winner). Normal flow is players report → staff confirms.
          </p>

          {matchList.length === 0 ? (
            <p className="mt-3 text-sm text-white/55">No matches yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
              <table className="min-w-[1400px] w-full border-collapse text-left text-[11px] leading-snug">
                <thead className="border-b border-white/10 bg-[#121213] text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2.5">Stage</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Round</th>
                    <th className="whitespace-nowrap px-3 py-2.5">P1</th>
                    <th className="whitespace-nowrap px-3 py-2.5">P2</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Deadline</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Status</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Score</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Winner</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {matchList.map((m) => {
                    const st = stageById.get(m.stage_id);
                    return (
                      <tr key={m.id} className="align-top text-white/80 hover:bg-white/[0.02]">
                        <td className="px-3 py-2">
                          <div className="text-white/90">{st?.name ?? "—"}</div>
                          <div className="font-mono text-[10px] text-white/35">{st?.type ?? ""}</div>
                        </td>
                        <td className="px-3 py-2">{m.round_label ?? "—"}</td>
                        <td className="max-w-[240px] px-3 py-2 font-mono text-[10px] text-white/65" title={m.player1_user_id}>
                          {m.player1_user_id}
                        </td>
                        <td className="max-w-[240px] px-3 py-2 font-mono text-[10px] text-white/65" title={m.player2_user_id}>
                          {m.player2_user_id}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-white/70">{fmtEt(m.scheduled_deadline)}</td>
                        <td className="px-3 py-2">
                          <StatusChip tone={m.status === "completed" ? "published" : "neutral"}>{m.status}</StatusChip>
                        </td>
                        <td className="px-3 py-2 text-white/70">
                          {typeof m.score_player1 === "number" && typeof m.score_player2 === "number"
                            ? `${m.score_player1}–${m.score_player2}`
                            : "—"}
                        </td>
                        <td className="max-w-[240px] px-3 py-2 font-mono text-[10px] text-white/65" title={m.winner_user_id ?? ""}>
                          {m.winner_user_id ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <details className="group">
                            <summary className="cursor-pointer select-none text-xs text-white/70 hover:text-white">
                              Edit
                            </summary>
                            <form action={updateMatchAdmin} className="mt-2 grid gap-2">
                              <input type="hidden" name="tournament_id" value={id} />
                              <input type="hidden" name="match_id" value={m.id} />
                              <input
                                name="player1_user_id"
                                defaultValue={m.player1_user_id}
                                className="w-[420px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-mono text-white"
                              />
                              <input
                                name="player2_user_id"
                                defaultValue={m.player2_user_id}
                                className="w-[420px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-mono text-white"
                              />
                              <input
                                name="scheduled_deadline"
                                defaultValue={m.scheduled_deadline ?? ""}
                                placeholder="ISO deadline"
                                className="w-[420px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
                              />
                              <div className="flex flex-wrap gap-2">
                                <input
                                  name="score_player1"
                                  defaultValue={typeof m.score_player1 === "number" ? String(m.score_player1) : ""}
                                  placeholder="P1 score"
                                  className="w-[110px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
                                />
                                <input
                                  name="score_player2"
                                  defaultValue={typeof m.score_player2 === "number" ? String(m.score_player2) : ""}
                                  placeholder="P2 score"
                                  className="w-[110px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
                                />
                                <select
                                  name="status"
                                  defaultValue={m.status}
                                  className="w-[180px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
                                >
                                  <option value="scheduled">scheduled</option>
                                  <option value="reported">reported</option>
                                  <option value="completed">completed</option>
                                  <option value="void">void</option>
                                </select>
                              </div>
                              <input
                                name="winner_user_id"
                                defaultValue={m.winner_user_id ?? ""}
                                placeholder="Winner user id (UUID)"
                                className="w-[420px] rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-mono text-white"
                              />
                              <button
                                type="submit"
                                className="w-fit rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black"
                              >
                                Save
                              </button>
                            </form>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

