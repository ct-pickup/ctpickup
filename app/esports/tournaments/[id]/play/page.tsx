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
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Play | Tournament ${id} | Esports | CT Pickup` };
}

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

export default async function EsportsTournamentPlayPage({ params }: Props) {
  const { id: tournamentId } = await params;

  const supabase = await supabaseServer();
  const user = await getAuthUserSafe(supabase);
  if (!user) redirect("/login?next=" + encodeURIComponent(`/esports/tournaments/${tournamentId}/play`));

  const { data: matches, error: mErr } = await supabase
    .from("esports_matches")
    .select("id,stage_id,group_id,player1_user_id,player2_user_id,scheduled_deadline,status,score_player1,score_player2,winner_user_id")
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

  const list = (matches || []) as Array<{
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

  const current =
    list.find((m) => m.status !== "completed" && m.status !== "void") ?? list[list.length - 1] ?? null;

  if (!current) {
    return (
      <PageShell maxWidthClass="max-w-3xl" className="pb-16">
        <TopNav rightSlot={<AuthenticatedProfileMenu />} />
        <header className="mt-4">
          <SectionEyebrow>Esports</SectionEyebrow>
          <h1 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
            Tournament play
          </h1>
        </header>
        <Panel className="mt-8 p-6 md:p-8">
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
      </PageShell>
    );
  }

  const youArePlayer1 = current.player1_user_id === user.id;
  const opponentId = youArePlayer1 ? current.player2_user_id : current.player1_user_id;

  const svc = supabaseService();
  const [{ data: stage }, { data: opponentProfile }] = await Promise.all([
    svc
      .from("esports_tournament_stages")
      .select("id,type,name")
      .eq("id", current.stage_id)
      .maybeSingle(),
    svc
      .from("esports_player_profiles")
      .select("platform,psn_id,xbox_gamertag,ea_account")
      .eq("user_id", opponentId)
      .maybeSingle(),
  ]);

  const stageType = String((stage as any)?.type ?? "—");
  const stageName = String((stage as any)?.name ?? "—");

  let opponentLabel = `User ${opponentId}`;
  const op = opponentProfile as any;
  if (op?.platform === "playstation" && op?.psn_id) opponentLabel = `PlayStation · ${String(op.psn_id)}`;
  if (op?.platform === "xbox" && op?.xbox_gamertag) opponentLabel = `Xbox · ${String(op.xbox_gamertag)}`;
  if (op?.ea_account && typeof op?.ea_account === "string" && op.ea_account.trim()) {
    opponentLabel += ` · EA: ${op.ea_account.trim()}`;
  }

  return (
    <PageShell maxWidthClass="max-w-3xl" className="pb-16">
      <TopNav rightSlot={<AuthenticatedProfileMenu />} />

      <header className="mt-4">
        <SectionEyebrow>Esports</SectionEyebrow>
        <h1 className="mt-4 text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
          Tournament play
        </h1>
        <p className="mt-3 text-sm text-white/60">
          Current match deadline (ET): <span className="text-white/80">{fmtEt(current.scheduled_deadline)}</span>
        </p>
      </header>

      <div className="mt-8">
        <EsportsTournamentPlayClient
          matchId={current.id}
          stageType={stageType}
          stageName={stageName}
          opponentLabel={opponentLabel}
          scheduledDeadlineIso={current.scheduled_deadline}
          youArePlayer1={youArePlayer1}
        />
      </div>

      <p className="mt-8 text-center text-sm text-white/45">
        <Link href={`/esports/tournaments/${tournamentId}`} className="underline-offset-4 hover:underline">
          Back to tournament
        </Link>
      </p>
    </PageShell>
  );
}

