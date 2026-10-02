import { supabaseService } from "@/lib/supabase/service";
import { HistoryBack } from "@/components/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        <HistoryBack
          fallbackHref="/"
          className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small text-muted underline underline-offset-4 hover:text-muted"
        />
        <h1 className="text-h2 font-serif font-semibold">No active run</h1>
      </main>
    );
  }

  const runLink = `https://ctpickup.vercel.app/run/${event.id}`; // swap to your domain later

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <HistoryBack
        fallbackHref="/"
        className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-small text-muted underline underline-offset-4 hover:text-muted"
      />
      <h1 className="text-h2 font-serif font-semibold">DM Templates</h1>

      <div className="mt-6 rounded-card border p-4 space-y-3">
        <div className="font-medium">IG Story line</div>
        <pre className="text-small whitespace-pre-wrap">Reply RUN for a chance to get in.</pre>

        <div className="font-medium">Manual DM reply</div>
        <pre className="text-small whitespace-pre-wrap">
{`Got you. Today’s options: A) ${String(event.time_option_a)} B) ${String(event.time_option_b)} RSVP + role here: ${runLink} Updates: https://ctpickup.vercel.app/status`}
        </pre>

        <div className="font-medium">Locked message</div>
        <pre className="text-small whitespace-pre-wrap">
{`Run is locked for ${String(event.locked_time || "[TIME]")} at ${String(event.location_name || "[LOCATION]")}. If you picked the other time, open the link to switch: ${runLink}`}
        </pre>
      </div>
    </main>
  );
}