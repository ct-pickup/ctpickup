import RunClient from "./RunClient";
import { supabaseService } from "@/lib/supabase/service";
import { HistoryBack } from "@/components/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Choice = "A" | "B";
type Counts = {
  a: { field_yes: number; goalie_yes: number; waitlist: number; yes_1a: number; yes_1b: number };
  b: { field_yes: number; goalie_yes: number; waitlist: number; yes_1a: number; yes_1b: number };
};

function agg(rows: any[], choice: Choice) {
  const yes = rows.filter((r) => r.choice === choice && r.status === "yes");
  const waitlist = rows.filter((r) => r.choice === choice && r.status === "waitlist").length;

  const field_yes = yes.filter((r) => r.role === "field").length;
  const goalie_yes = yes.filter((r) => r.role === "goalie").length;

  const yes_1a = yes.filter((r) => r.player?.tier === "1A").length;
  const yes_1b = yes.filter((r) => r.player?.tier === "1B").length;

  return { field_yes, goalie_yes, waitlist, yes_1a, yes_1b };
}

export default async function RunPage({ params }: { params: { eventId: string } }) {
  const supabase = supabaseService();

  const { data: event, error: eErr } = await supabase
    .from("events")
    .select("*")
    .eq("id", params.eventId)
    .single();

  if (eErr || !event) {
    return (
      <main className="min-h-screen p-6">
        <HistoryBack
          fallbackHref="/status/pickup"
          className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
        />
        <h1 className="text-2xl font-semibold">Run not found</h1>
      </main>
    );
  }

  const { data: rows } = await supabase
    .from("rsvps")
    .select("choice,role,status, player:players(tier)")
    .eq("event_id", params.eventId);

  const counts: Counts = {
    a: agg(rows || [], "A"),
    b: agg(rows || [], "B"),
  };

  return <RunClient event={event} counts={counts} />;
}