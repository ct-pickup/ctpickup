import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  SectionEyebrow,
  TopNav,
} from "@/components/layout";
import { EsportsTournamentPlayClient } from "@/components/esports/EsportsTournamentPlayClient";
import { formatEsportsOpponentLabel } from "@/lib/esports/opponentDisplay";
import { maybeEscalateConfirmationDeadline } from "@/lib/esports/matchWorkflowServer";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { EsportsMatchReportRow } from "@/lib/esports/matchWorkflowTypes";
import type { EsportsMatchWorkflowStatus } from "@/lib/esports/matchWorkflowTypes";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Play | Tournament ${id} | Esports | CT Pickup` };
}

export default async function EsportsTournamentPlayPage({ params }: Props) {
  const { id: tournamentId } = await params;

  const supabase = await supabaseServer();
  const user = await getAuthUserSafe(supabase);
  if (!user) redirect("/login?next=" + encodeURIComponent(`/esports/tournaments/${tournamentId}/play`));

  const svc = supabaseService();

  const { data: tourRow } = await svc
    .from("esports_tournaments")
    .select("require_match_proof")
    .eq("id", tournamentId)
    .maybeSingle();
  const requireMatchProof = Boolean((tourRow as { require_match_proof?: boolean } | null)?.require_match_proof);

  const { data: matches, error: mErr } = await svc
    .from("esports_matches")
    .select(
      "id,stage_id,group_id,player1_user_id,player2_user_id,scheduled_deadline,status,score_player1,score_player2,winner_user_id",
    )
    .eq("tournament_id", tournamentId)
    .or(`player1_user_id.eq.${user.id},player2_user_id.eq.${user.id}`)
    .order("scheduled_deadline", { ascending: true });

  if (mErr) {
    return (
      <PageShell maxWidthClass="max-w-3xl" className="pb-16">
        <TopNav rightSlot={<AuthenticatedProfileMenu />} />
        <Panel className="mt-8 p-6 md:p-8">
          <p className="text-sm text-red-200">Could not load your matches.</p>
        </Panel>
      </PageShell>
    );
  }

  const list =
    (matches || []) as Array<{
      id: string;
      stage_id: string;
      group_id: string | null;
      player1_user_id: string;
      player2_user_id: string;
      scheduled_deadline: string | null;
      status: string;
      score_player1: number | null;
      score_player2: number | null;
      winner_user_id: string | null;
    }>;

  await Promise.all(list.map((m) => maybeEscalateConfirmationDeadline(svc, m.id)));

  const { data: matchesAfter } = await svc
    .from("esports_matches")
    .select(
      "id,stage_id,group_id,player1_user_id,player2_user_id,scheduled_deadline,status,score_player1,score_player2,winner_user_id",
    )
    .eq("tournament_id", tournamentId)
    .or(`player1_user_id.eq.${user.id},player2_user_id.eq.${user.id}`)
    .order("scheduled_deadline", { ascending: true });

  const list2 = (matchesAfter || list) as typeof list;

  const matchIds = list2.map((m) => m.id);
  const { data: reportRows } =
    matchIds.length > 0
      ? await svc.from("esports_match_reports").select("*").in("match_id", matchIds)
      : { data: [] as EsportsMatchReportRow[] };

  const reportByMatch = new Map<string, EsportsMatchReportRow>();
  for (const r of (reportRows || []) as EsportsMatchReportRow[]) {
    reportByMatch.set(r.match_id, r);
  }

  const stageIds = [...new Set(list2.map((m) => m.stage_id))];
  const { data: stageRows } =
    stageIds.length > 0
      ? await svc.from("esports_tournament_stages").select("id,type,name").in("id", stageIds)
      : { data: [] as Array<{ id: string; type: string; name: string }> };

  const stageById = new Map((stageRows || []).map((s) => [s.id, s]));

  const entries = await Promise.all(
    list2.map(async (m) => {
      const youArePlayer1 = m.player1_user_id === user.id;
      const opponentId = youArePlayer1 ? m.player2_user_id : m.player1_user_id;
      const opponentLabel = await formatEsportsOpponentLabel(svc, opponentId);
      const st = stageById.get(m.stage_id);
      const rep = reportByMatch.get(m.id) ?? null;
      return {
        matchId: m.id,
        stageType: String(st?.type ?? "—"),
        stageName: String(st?.name ?? "—"),
        opponentLabel,
        scheduledDeadlineIso: m.scheduled_deadline,
        youArePlayer1,
        reporterIsYou: rep ? rep.reporter_user_id === user.id : false,
        status: m.status as EsportsMatchWorkflowStatus,
        scorePlayer1: m.score_player1,
        scorePlayer2: m.score_player2,
        winnerUserId: m.winner_user_id,
        report: rep,
      };
    }),
  );

  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />

      <header className="mt-4">
        <SectionEyebrow>Esports</SectionEyebrow>
        <h1 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
          Tournament play
        </h1>
        <p className="mt-3 text-sm text-white/60">
          Report results, upload a score screenshot, and confirm or dispute when you are the opponent.
        </p>
      </header>

      <div className="mt-8">
        {entries.length === 0 ? (
          <Panel className="p-6 md:p-8">
            <p className="text-sm text-white/70">You don’t have any matches for this tournament yet.</p>
            <p className="mt-4 text-sm">
              <Link
                href={`/esports/tournaments/${tournamentId}`}
                className="text-[var(--brand)] underline-offset-4 hover:underline"
              >
                Back to tournament page
              </Link>
            </p>
          </Panel>
        ) : (
          <EsportsTournamentPlayClient entries={entries} requireMatchProof={requireMatchProof} />
        )}
      </div>

      <p className="mt-8 text-center text-sm text-white/45">
        <Link href={`/esports/tournaments/${tournamentId}`} className="underline-offset-4 hover:underline">
          Back to tournament
        </Link>
      </p>
    </PageShell>
  );
}
