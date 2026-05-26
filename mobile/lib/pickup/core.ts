import { supabaseService } from "@/lib/supabase/service";

type Choice = "A" | "B";
type Role = "field" | "goalie";
type RsvpStatus = "yes" | "no" | "maybe" | "waitlist";

function normIG(ig: string) {
  return ig.trim().replace(/^@/, "").toLowerCase();
}

export type Counts = {
  a: { field_yes: number; goalie_yes: number; waitlist: number; yes_1a: number; yes_1b: number };
  b: { field_yes: number; goalie_yes: number; waitlist: number; yes_1a: number; yes_1b: number };
};

export async function commit_rsvp(args: {
  event_id: string;
  ig_handle: string;
  name?: string | null;
  choice: Choice;
  role: Role;
}): Promise<{
  player_id: string;
  rsvp_status: RsvpStatus;
  locked: boolean;
  locked_choice: Choice | null;
  locked_time: string | null;
  counts: Counts;
  message: string;
}> {
  const supabase = supabaseService();

  const ig_norm = normIG(args.ig_handle);
  if (!ig_norm) throw new Error("Missing Instagram handle.");

  // 1) upsert player
  const { data: player, error: pErr } = await supabase
    .from("players")
    .upsert({ ig_handle: ig_norm, name: args.name ?? null }, { onConflict: "ig_handle_norm" })
    .select("id,tier,status")
    .single();

  if (pErr || !player) throw new Error(pErr?.message || "Player error.");
  if (player.status !== "active") throw new Error("Player is not active.");

  // 2) load event
  const { data: event, error: eErr } = await supabase
    .from("events")
    .select("*")
    .eq("id", args.event_id)
    .single();

  if (eErr || !event) throw new Error(eErr?.message || "Event not found.");

  // If locked, force any new RSVP to locked side
  const lockedChoice: Choice | null =
    event.status === "locked"
      ? (event.locked_time === event.time_option_a ? "A" : "B")
      : null;

  const targetChoice: Choice = lockedChoice ?? args.choice;

  // 3) enforce caps per choice before writing
  const { data: capRows, error: cErr } = await supabase
    .from("rsvps")
    .select("role,status")
    .eq("event_id", args.event_id)
    .eq("choice", targetChoice);

  if (cErr) throw new Error(cErr.message);

  const fieldYes = capRows.filter(r => r.role === "field" && r.status === "yes").length;
  const goalieYes = capRows.filter(r => r.role === "goalie" && r.status === "yes").length;

  let finalStatus: RsvpStatus = "yes";
  if (args.role === "field" && fieldYes >= event.field_max) finalStatus = "waitlist";
  if (args.role === "goalie" && goalieYes >= event.goalie_max) finalStatus = "waitlist";

  // 4) upsert RSVP
  const { error: rErr } = await supabase
    .from("rsvps")
    .upsert(
      {
        event_id: args.event_id,
        player_id: player.id,
        status: finalStatus,
        choice: targetChoice,
        role: args.role,
        source: "web",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,player_id" }
    );

  if (rErr) throw new Error(rErr.message);

  // 5) lock evaluation
  const lockResult = await evaluate_lock(args.event_id);

  return {
    player_id: player.id,
    rsvp_status: finalStatus,
    locked: lockResult.locked,
    locked_choice: lockResult.locked_choice,
    locked_time: lockResult.locked_time,
    counts: lockResult.counts,
    message:
      finalStatus === "waitlist"
        ? "Role pool is full for that option. You’re waitlisted."
        : "RSVP recorded.",
  };
}

export async function evaluate_lock(event_id: string): Promise<{
  locked: boolean;
  locked_choice: Choice | null;
  locked_time: string | null;
  counts: Counts;
}> {
  const supabase = supabaseService();

  const { data: event, error: eErr } = await supabase
    .from("events")
    .select("*")
    .eq("id", event_id)
    .single();

  if (eErr || !event) throw new Error(eErr?.message || "Event not found.");

  const lockRule = event.lock_rule || {};
  const THRESH_1A = Number(lockRule.yes_1a ?? 3);
  const THRESH_1A1B = Number(lockRule.yes_1a_1b ?? 6);

  const { data: rows, error: rErr } = await supabase
    .from("rsvps")
    .select("choice,role,status, player:players(tier)")
    .eq("event_id", event_id);

  if (rErr) throw new Error(rErr.message);

  const rsvpRows = rows ?? [];

  function agg(choice: Choice) {
    const yes = rsvpRows.filter(r => r.choice === choice && r.status === "yes");
    const waitlist = rsvpRows.filter(r => r.choice === choice && r.status === "waitlist").length;

    const field_yes = yes.filter(r => r.role === "field").length;
    const goalie_yes = yes.filter(r => r.role === "goalie").length;

    const playerTier = (r: (typeof yes)[number]) => {
      const p = r.player as { tier?: string } | { tier?: string }[] | null | undefined;
      if (!p) return undefined;
      return Array.isArray(p) ? p[0]?.tier : p.tier;
    };
    const yes_1a = yes.filter((r) => playerTier(r) === "1A").length;
    const yes_1b = yes.filter((r) => playerTier(r) === "1B").length;

    return { field_yes, goalie_yes, waitlist, yes_1a, yes_1b };
  }

  const A = agg("A");
  const B = agg("B");

  const counts: Counts = { a: A, b: B };

  if (event.status === "locked") {
    const locked_choice: Choice = event.locked_time === event.time_option_a ? "A" : "B";
    return { locked: true, locked_choice, locked_time: event.locked_time, counts };
  }

  const minsOK = (x: { field_yes: number; goalie_yes: number }) =>
    x.field_yes >= event.field_min && x.goalie_yes >= event.goalie_min;

  const meetsThreshold = (x: { yes_1a: number; yes_1b: number }) =>
    x.yes_1a >= THRESH_1A || (x.yes_1a + x.yes_1b) >= THRESH_1A1B;

  const A_meets = meetsThreshold(A) && minsOK(A);
  const B_meets = meetsThreshold(B) && minsOK(B);

  if (!A_meets && !B_meets) {
    return { locked: false, locked_choice: null, locked_time: null, counts };
  }

  // tie rule: higher 1A wins; if tied, lock A
  let lockChoice: Choice = "A";
  if (A_meets && !B_meets) lockChoice = "A";
  if (B_meets && !A_meets) lockChoice = "B";
  if (A_meets && B_meets) {
    if (B.yes_1a > A.yes_1a) lockChoice = "B";
    else lockChoice = "A";
  }

  const lockTime = lockChoice === "A" ? event.time_option_a : event.time_option_b;

  const { error: uErr } = await supabase
    .from("events")
    .update({ status: "locked", locked_time: lockTime })
    .eq("id", event_id);

  if (uErr) throw new Error(uErr.message);

  return { locked: true, locked_choice: lockChoice, locked_time: lockTime, counts };
}

export function switch_prompt_logic(args: {
  event_status: "draft" | "active" | "locked" | "closed";
  locked_choice: Choice | null;
  player_rsvp_choice: Choice | "NONE";
  player_rsvp_status: RsvpStatus;
}) {
  if (args.event_status !== "locked") return { needs_switch: false };
  if (!args.locked_choice) return { needs_switch: false };
  if (args.player_rsvp_status !== "yes") return { needs_switch: false };
  if (args.player_rsvp_choice === "NONE") return { needs_switch: false };
  return { needs_switch: args.player_rsvp_choice !== args.locked_choice };
}

export async function switch_to_locked(args: {
  event_id: string;
  ig_handle: string;
}): Promise<{ status: RsvpStatus; locked_choice: Choice; message: string }> {
  const supabase = supabaseService();
  const ig_norm = normIG(args.ig_handle);

  const { data: player, error: pErr } = await supabase
    .from("players")
    .select("id")
    .eq("ig_handle_norm", ig_norm)
    .single();

  if (pErr || !player) throw new Error("Player not found.");

  const { data: event, error: eErr } = await supabase
    .from("events")
    .select("*")
    .eq("id", args.event_id)
    .single();

  if (eErr || !event || event.status !== "locked") throw new Error("Event not locked.");

  const locked_choice: Choice = event.locked_time === event.time_option_a ? "A" : "B";

  const { data: rsvp, error: rErr } = await supabase
    .from("rsvps")
    .select("*")
    .eq("event_id", args.event_id)
    .eq("player_id", player.id)
    .single();

  if (rErr || !rsvp) throw new Error("RSVP not found.");

  const { data: capRows, error: cErr } = await supabase
    .from("rsvps")
    .select("role,status")
    .eq("event_id", args.event_id)
    .eq("choice", locked_choice);

  if (cErr) throw new Error(cErr.message);

  const fieldYes = capRows.filter(r => r.role === "field" && r.status === "yes").length;
  const goalieYes = capRows.filter(r => r.role === "goalie" && r.status === "yes").length;

  let finalStatus: RsvpStatus = "yes";
  if (rsvp.role === "field" && fieldYes >= event.field_max) finalStatus = "waitlist";
  if (rsvp.role === "goalie" && goalieYes >= event.goalie_max) finalStatus = "waitlist";

  const { error } = await supabase
    .from("rsvps")
    .update({ choice: locked_choice, status: finalStatus, updated_at: new Date().toISOString() })
    .eq("event_id", args.event_id)
    .eq("player_id", player.id);

  if (error) throw new Error(error.message);

  return {
    status: finalStatus,
    locked_choice,
    message:
      finalStatus === "waitlist"
        ? "Locked roster is full for your role. You’re waitlisted."
        : "Switched to locked time.",
  };
}