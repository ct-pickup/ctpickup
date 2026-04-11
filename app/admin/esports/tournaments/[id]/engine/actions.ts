"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthUserSafe, supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

async function assertAdmin(tournamentIdForRedirect?: string) {
  const supabase = await supabaseServer();
  const user = await getAuthUserSafe(supabase);
  const back = tournamentIdForRedirect
    ? `/admin/esports/tournaments/${tournamentIdForRedirect}/engine`
    : "/admin/esports";
  if (!user?.id) redirect("/login?next=" + encodeURIComponent(back));

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof?.is_admin) redirect("/");
}

function mustUuid(label: string, raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error(`${label} is required.`);
  if (!/^[0-9a-fA-F-]{36}$/.test(s)) throw new Error(`${label} must be a UUID.`);
  return s;
}

function mustInt(label: string, raw: unknown, { min, max }: { min: number; max: number }): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${label} must be an integer.`);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
}

function mustIsoTs(label: string, raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error(`${label} is required.`);
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`${label} must be a valid date/time (ISO 8601 recommended).`);
  return new Date(ms).toISOString();
}

function shuffle<T>(arr: T[]): T[] {
  // Fisher–Yates (non-crypto is fine for pairing randomness).
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRoundRobinPairs(players: string[]): Array<Array<[string, string]>> {
  // Circle method. If odd, add a bye (null) and drop pairs with bye.
  const list = [...players];
  const hasBye = list.length % 2 === 1;
  if (hasBye) list.push("__BYE__");

  const n = list.length;
  const rounds: Array<Array<[string, string]>> = [];
  const fixed = list[0];
  let rot = list.slice(1);

  for (let r = 0; r < n - 1; r += 1) {
    const left = [fixed, ...rot.slice(0, (n / 2) - 1)];
    const right = rot.slice((n / 2) - 1).reverse();

    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < left.length; i += 1) {
      const a = left[i];
      const b = right[i];
      if (a === "__BYE__" || b === "__BYE__") continue;
      pairs.push([a, b]);
    }
    rounds.push(pairs);

    // rotate
    rot = [rot[rot.length - 1]!, ...rot.slice(0, rot.length - 1)];
  }

  return rounds;
}

export async function generateGroupStage(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  await assertAdmin(tournament_id);

  const groupSize = mustInt("Group size", formData.get("group_size"), { min: 3, max: 8 });
  const monday = mustIsoTs("Monday deadline", formData.get("deadline_monday"));
  const tuesday = mustIsoTs("Tuesday deadline", formData.get("deadline_tuesday"));
  const wednesday = mustIsoTs("Wednesday deadline", formData.get("deadline_wednesday"));

  const svc = supabaseService();

  const { data: regs, error: rErr } = await svc
    .from("esports_tournament_registrations")
    .select("user_id,payment_status")
    .eq("tournament_id", tournament_id)
    .eq("payment_status", "paid");

  if (rErr) throw new Error(rErr.message);
  const userIds = (regs || []).map((r) => String((r as { user_id: string }).user_id));
  if (userIds.length < 2) {
    throw new Error("Not enough paid players to generate matches.");
  }

  const { data: stage, error: sErr } = await svc
    .from("esports_tournament_stages")
    .insert({
      tournament_id,
      type: "group_stage",
      name: "Group stage",
      order_index: 1,
      status: "active",
    })
    .select("id")
    .single();
  if (sErr) throw new Error(sErr.message);

  const stage_id = String((stage as { id: string }).id);

  const shuffled = shuffle(userIds);
  const groupCount = Math.ceil(shuffled.length / groupSize);
  const groupNames = Array.from({ length: groupCount }).map((_, idx) => `Group ${String.fromCharCode(65 + idx)}`);

  const { data: groups, error: gErr } = await svc
    .from("esports_tournament_groups")
    .insert(
      groupNames.map((name) => ({
        tournament_id,
        stage_id,
        name,
      })),
    )
    .select("id,name");
  if (gErr) throw new Error(gErr.message);

  const groupRows = (groups || []) as Array<{ id: string; name: string }>;
  const groupToPlayers = new Map<string, string[]>();
  groupRows.forEach((g) => groupToPlayers.set(g.id, []));

  shuffled.forEach((uid, i) => {
    const groupIdx = i % groupRows.length;
    const gid = groupRows[groupIdx]!.id;
    groupToPlayers.get(gid)!.push(uid);
  });

  const matchInserts: Array<Record<string, unknown>> = [];

  for (const g of groupRows) {
    const players = groupToPlayers.get(g.id) || [];
    if (players.length < 2) continue;

    const rounds = buildRoundRobinPairs(players);
    rounds.forEach((pairs, roundIdx) => {
      const deadline =
        roundIdx === 0 ? monday : roundIdx === 1 ? tuesday : wednesday; // everything after round 2 is due by Wed 11:59 PM
      const label = roundIdx === 0 ? "Monday" : roundIdx === 1 ? "Tuesday" : "Wednesday";

      pairs.forEach(([a, b]) => {
        matchInserts.push({
          tournament_id,
          stage_id,
          group_id: g.id,
          player1_user_id: a,
          player2_user_id: b,
          scheduled_deadline: deadline,
          status: "scheduled",
          round_label: label,
        });
      });
    });
  }

  const { error: mErr } = await svc.from("esports_matches").insert(matchInserts);
  if (mErr) throw new Error(mErr.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  redirect(`/admin/esports/tournaments/${tournament_id}/engine?ok=group_stage_generated`);
}

export async function lockGroupStage(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  await assertAdmin(tournament_id);
  const svc = supabaseService();

  const { error } = await svc
    .from("esports_tournament_stages")
    .update({ status: "locked" })
    .eq("tournament_id", tournament_id)
    .eq("type", "group_stage");
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  redirect(`/admin/esports/tournaments/${tournament_id}/engine?ok=group_stage_locked`);
}

type Standing = {
  userId: string;
  wins: number;
  losses: number;
  gf: number;
  ga: number;
};

function cmpStanding(a: Standing, b: Standing): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  const gdA = a.gf - a.ga;
  const gdB = b.gf - b.ga;
  if (gdB !== gdA) return gdB - gdA;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.userId.localeCompare(b.userId);
}

function stageTypeForPlayers(n: number): "round_of_16" | "quarterfinal" | "semifinal" | "final" {
  if (n === 16) return "round_of_16";
  if (n === 8) return "quarterfinal";
  if (n === 4) return "semifinal";
  if (n === 2) return "final";
  throw new Error(`Advancing player count must be 16, 8, 4, or 2. Got ${n}.`);
}

function stageNameForType(t: string): string {
  if (t === "round_of_16") return "Round of 16";
  if (t === "quarterfinal") return "Quarterfinals";
  if (t === "semifinal") return "Semifinals";
  if (t === "final") return "Final";
  return t;
}

function deadlineForStageType(input: {
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  stageType: string;
}): string {
  const { stageType } = input;
  if (stageType === "round_of_16") return input.thursday;
  if (stageType === "quarterfinal") return input.friday;
  if (stageType === "semifinal") return input.saturday;
  if (stageType === "final") return input.sunday;
  return input.thursday;
}

export async function generateKnockoutFromGroups(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  await assertAdmin(tournament_id);

  const advancePerGroup = mustInt("Advance per group", formData.get("advance_per_group"), { min: 1, max: 4 });
  const thursday = mustIsoTs("Thursday deadline", formData.get("deadline_thursday"));
  const friday = mustIsoTs("Friday deadline", formData.get("deadline_friday"));
  const saturday = mustIsoTs("Saturday deadline", formData.get("deadline_saturday"));
  const sunday = mustIsoTs("Sunday deadline", formData.get("deadline_sunday"));

  const svc = supabaseService();

  const { data: groupStage, error: gsErr } = await svc
    .from("esports_tournament_stages")
    .select("id,status")
    .eq("tournament_id", tournament_id)
    .eq("type", "group_stage")
    .order("created_at", { ascending: false })
    .maybeSingle();
  if (gsErr) throw new Error(gsErr.message);
  if (!groupStage?.id) throw new Error("No group stage found. Generate the group stage first.");

  if (groupStage.status !== "locked" && groupStage.status !== "completed") {
    throw new Error("Lock the group stage before generating the knockout bracket.");
  }

  const groupStageId = String(groupStage.id);

  const [{ data: groups, error: gErr }, { data: matches, error: mErr }] = await Promise.all([
    svc
      .from("esports_tournament_groups")
      .select("id,name")
      .eq("tournament_id", tournament_id)
      .eq("stage_id", groupStageId)
      .order("name", { ascending: true }),
    svc
      .from("esports_matches")
      .select("group_id,player1_user_id,player2_user_id,status,winner_user_id,score_player1,score_player2")
      .eq("tournament_id", tournament_id)
      .eq("stage_id", groupStageId),
  ]);
  if (gErr) throw new Error(gErr.message);
  if (mErr) throw new Error(mErr.message);

  const groupRows = (groups || []) as Array<{ id: string; name: string }>;
  if (groupRows.length === 0) throw new Error("No groups found for this group stage.");

  const matchRows = (matches || []) as Array<{
    group_id: string | null;
    player1_user_id: string;
    player2_user_id: string;
    status: string;
    winner_user_id: string | null;
    score_player1: number | null;
    score_player2: number | null;
  }>;

  const groupToStandings = new Map<string, Map<string, Standing>>();
  for (const g of groupRows) groupToStandings.set(g.id, new Map());

  for (const m of matchRows) {
    if (!m.group_id) continue;
    const map = groupToStandings.get(m.group_id);
    if (!map) continue;

    const p1 = m.player1_user_id;
    const p2 = m.player2_user_id;
    if (!map.has(p1)) map.set(p1, { userId: p1, wins: 0, losses: 0, gf: 0, ga: 0 });
    if (!map.has(p2)) map.set(p2, { userId: p2, wins: 0, losses: 0, gf: 0, ga: 0 });

    const s1 = typeof m.score_player1 === "number" ? m.score_player1 : null;
    const s2 = typeof m.score_player2 === "number" ? m.score_player2 : null;
    if (s1 != null && s2 != null) {
      const a = map.get(p1)!;
      const b = map.get(p2)!;
      a.gf += s1;
      a.ga += s2;
      b.gf += s2;
      b.ga += s1;
    }

    if (m.status === "completed" && m.winner_user_id) {
      const win = m.winner_user_id;
      const lose = win === p1 ? p2 : p1;
      map.get(win)!.wins += 1;
      map.get(lose)!.losses += 1;
    }
  }

  const advancing: string[] = [];
  for (const g of groupRows) {
    const standings = [...(groupToStandings.get(g.id)?.values() || [])].sort(cmpStanding);
    const take = standings.slice(0, advancePerGroup);
    take.forEach((s) => advancing.push(s.userId));
  }

  const uniqueAdvancing = [...new Set(advancing)];
  if (uniqueAdvancing.length !== advancing.length) {
    throw new Error("Duplicate advancing players detected (check group data).");
  }

  const stageType = stageTypeForPlayers(uniqueAdvancing.length);
  const order_index = stageType === "round_of_16" ? 2 : stageType === "quarterfinal" ? 3 : stageType === "semifinal" ? 4 : 5;

  const { data: stage, error: sErr } = await svc
    .from("esports_tournament_stages")
    .insert({
      tournament_id,
      type: stageType,
      name: stageNameForType(stageType),
      order_index,
      status: "active",
    })
    .select("id")
    .single();
  if (sErr) throw new Error(sErr.message);
  const stage_id = String((stage as { id: string }).id);

  // Seed order: Group A #1, Group B #1... then Group A #2, Group B #2...
  const groupRanked: string[][] = groupRows.map((g) => {
    const standings = [...(groupToStandings.get(g.id)?.values() || [])].sort(cmpStanding);
    return standings.slice(0, advancePerGroup).map((s) => s.userId);
  });

  const seeds: string[] = [];
  for (let r = 0; r < advancePerGroup; r += 1) {
    for (let gi = 0; gi < groupRanked.length; gi += 1) {
      const uid = groupRanked[gi]?.[r];
      if (uid) seeds.push(uid);
    }
  }

  if (seeds.length !== uniqueAdvancing.length) {
    throw new Error("Could not build seeded advancing list (missing standings).");
  }

  const deadline = deadlineForStageType({ thursday, friday, saturday, sunday, stageType });
  const n = seeds.length;
  const matchInserts: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n / 2; i += 1) {
    const p1 = seeds[i]!;
    const p2 = seeds[n - 1 - i]!;
    matchInserts.push({
      tournament_id,
      stage_id,
      group_id: null,
      player1_user_id: p1,
      player2_user_id: p2,
      scheduled_deadline: deadline,
      status: "scheduled",
      round_label: stageNameForType(stageType),
      bracket_slot: i + 1,
    });
  }

  const { error: insErr } = await svc.from("esports_matches").insert(matchInserts);
  if (insErr) throw new Error(insErr.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  redirect(`/admin/esports/tournaments/${tournament_id}/engine?ok=knockout_generated`);
}

export async function generateNextKnockoutRound(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  await assertAdmin(tournament_id);

  const thursday = mustIsoTs("Thursday deadline", formData.get("deadline_thursday"));
  const friday = mustIsoTs("Friday deadline", formData.get("deadline_friday"));
  const saturday = mustIsoTs("Saturday deadline", formData.get("deadline_saturday"));
  const sunday = mustIsoTs("Sunday deadline", formData.get("deadline_sunday"));

  const svc = supabaseService();

  const { data: stages, error: sErr } = await svc
    .from("esports_tournament_stages")
    .select("id,type,order_index,status")
    .eq("tournament_id", tournament_id)
    .in("type", ["round_of_16", "quarterfinal", "semifinal"])
    .order("order_index", { ascending: false });
  if (sErr) throw new Error(sErr.message);
  const list = (stages || []) as Array<{ id: string; type: string; order_index: number; status: string }>;
  const current = list[0];
  if (!current) throw new Error("No knockout stage found yet. Generate the initial knockout stage first.");
  if (current.status !== "locked" && current.status !== "completed") {
    throw new Error("Lock the current knockout stage before generating the next round.");
  }

  const nextType =
    current.type === "round_of_16"
      ? "quarterfinal"
      : current.type === "quarterfinal"
        ? "semifinal"
        : "final";

  const { data: prevMatches, error: mErr } = await svc
    .from("esports_matches")
    .select("winner_user_id,status,bracket_slot")
    .eq("tournament_id", tournament_id)
    .eq("stage_id", current.id)
    .order("bracket_slot", { ascending: true });
  if (mErr) throw new Error(mErr.message);
  const winners = (prevMatches || [])
    .filter((m) => (m as { status: string }).status === "completed")
    .map((m) => (m as { winner_user_id: string | null }).winner_user_id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  if (winners.length * 2 !== (prevMatches || []).length) {
    throw new Error("All matches in the current round must be completed with winners.");
  }

  const stageType = nextType as "quarterfinal" | "semifinal" | "final";
  const { data: stage, error: insStageErr } = await svc
    .from("esports_tournament_stages")
    .insert({
      tournament_id,
      type: stageType,
      name: stageNameForType(stageType),
      order_index: current.order_index + 1,
      status: "active",
    })
    .select("id")
    .single();
  if (insStageErr) throw new Error(insStageErr.message);

  const deadline = deadlineForStageType({ thursday, friday, saturday, sunday, stageType });
  const stage_id = String((stage as { id: string }).id);

  const inserts: Array<Record<string, unknown>> = [];
  for (let i = 0; i < winners.length; i += 2) {
    inserts.push({
      tournament_id,
      stage_id,
      group_id: null,
      player1_user_id: winners[i]!,
      player2_user_id: winners[i + 1]!,
      scheduled_deadline: deadline,
      status: "scheduled",
      round_label: stageNameForType(stageType),
      bracket_slot: Math.floor(i / 2) + 1,
    });
  }

  const { error: insErr } = await svc.from("esports_matches").insert(inserts);
  if (insErr) throw new Error(insErr.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  redirect(`/admin/esports/tournaments/${tournament_id}/engine?ok=next_round_generated`);
}

export async function lockKnockoutStage(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  const stage_id = mustUuid("Stage id", formData.get("stage_id"));
  await assertAdmin(tournament_id);

  const svc = supabaseService();
  const { error } = await svc
    .from("esports_tournament_stages")
    .update({ status: "locked" })
    .eq("id", stage_id)
    .eq("tournament_id", tournament_id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  redirect(`/admin/esports/tournaments/${tournament_id}/engine?ok=stage_locked`);
}

export async function updateMatchAdmin(formData: FormData) {
  const tournament_id = mustUuid("Tournament id", formData.get("tournament_id"));
  await assertAdmin(tournament_id);

  const match_id = mustUuid("Match id", formData.get("match_id"));
  const player1_user_id = mustUuid("Player 1", formData.get("player1_user_id"));
  const player2_user_id = mustUuid("Player 2", formData.get("player2_user_id"));
  const scheduled_deadline = String(formData.get("scheduled_deadline") || "").trim() || null;
  const statusRaw = String(formData.get("status") || "").trim() || "scheduled";
  const allowedStatuses = new Set([
    "scheduled",
    "awaiting_confirmation",
    "disputed",
    "under_review",
    "completed",
    "void",
    "forfeit",
  ]);
  if (!allowedStatuses.has(statusRaw)) {
    throw new Error("Invalid match status.");
  }
  const status = statusRaw;
  const winner_user_id = String(formData.get("winner_user_id") || "").trim() || null;
  const score_player1_raw = String(formData.get("score_player1") || "").trim();
  const score_player2_raw = String(formData.get("score_player2") || "").trim();

  const score_player1 = score_player1_raw === "" ? null : Number(score_player1_raw);
  const score_player2 = score_player2_raw === "" ? null : Number(score_player2_raw);

  if (score_player1 != null && (!Number.isFinite(score_player1) || !Number.isInteger(score_player1) || score_player1 < 0)) {
    throw new Error("Score (player 1) must be a non-negative integer.");
  }
  if (score_player2 != null && (!Number.isFinite(score_player2) || !Number.isInteger(score_player2) || score_player2 < 0)) {
    throw new Error("Score (player 2) must be a non-negative integer.");
  }

  const deadlineIso = scheduled_deadline ? mustIsoTs("Scheduled deadline", scheduled_deadline) : null;
  const winner = winner_user_id ? mustUuid("Winner", winner_user_id) : null;

  const svc = supabaseService();
  const { error } = await svc
    .from("esports_matches")
    .update({
      player1_user_id,
      player2_user_id,
      scheduled_deadline: deadlineIso,
      status,
      winner_user_id: winner,
      score_player1,
      score_player2,
      updated_at: new Date().toISOString(),
    })
    .eq("id", match_id)
    .eq("tournament_id", tournament_id);

  if (error) throw new Error(error.message);
  revalidatePath(`/admin/esports/tournaments/${tournament_id}/engine`);
  redirect(`/admin/esports/tournaments/${tournament_id}/engine?ok=match_updated`);
}

