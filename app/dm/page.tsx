import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

export default async function DMPage() {
  const supabase = supabaseService();

  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("type", "pickup")
    .in("status", ["active", "locked"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!event) {
    return (
      <main className="min-h-screen p-6">
        <h1 className="text-2xl font-semibold">No active run</h1>
      </main>
    );
  }

  const runLink = `https://ctpickup.vercel.app/run/${event.id}`; // swap to your domain later

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold">DM Templates</h1>

      <div className="mt-6 rounded-xl border p-4 space-y-3">
        <div className="font-medium">IG Story line</div>
        <pre className="text-sm whitespace-pre-wrap">Reply RUN for a chance to get in.</pre>

        <div className="font-medium">Manual DM reply</div>
        <pre className="text-sm whitespace-pre-wrap">
{`Got you. Today’s options:
A) ${String(event.time_option_a)}
B) ${String(event.time_option_b)}
RSVP + role here: ${runLink}
Updates: https://ctpickup.vercel.app/status`}
        </pre>

        <div className="font-medium">Locked message</div>
        <pre className="text-sm whitespace-pre-wrap">
{`Run is locked for ${String(event.locked_time || "[TIME]")} at ${String(event.location_name || "[LOCATION]")}.
If you picked the other time, open the link to switch: ${runLink}`}
        </pre>
      </div>
    </main>
  );
}