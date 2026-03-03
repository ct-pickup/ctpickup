import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type StatusRow = {
  id: number;
  phase: string;
  primary_slot: string | null;
  secondary_slot: string | null;
  next_update_by: string | null;
  announcement: string | null;
  updated_at: string;
  updated_by: string | null;
};

function supabasePublic() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

function prettyDate(iso: string | null) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default async function StatusPage() {
  const supabase = supabasePublic();

  const { data, error } = await supabase
    .from("status_updates")
    .select("*")
    .eq("id", 1)
    .single<StatusRow>();

  if (error || !data) {
    return (
      <main className="min-h-screen p-6">
        <h1 className="text-2xl font-semibold">CT Pickup Status</h1>

      <p className="mt-2 text-sm text-gray-600">
        Need to change your availability?{" "}
        <a className="underline" href="/update">Fix / Edit My Submission</a>
      </p>
        <p className="mt-4 text-red-600">
          Couldn’t load status yet. Check env vars + Supabase table.
        </p>
        <pre className="mt-4 text-sm whitespace-pre-wrap">
          {String(error?.message)}
        </pre>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold">CT Pickup Status</h1>

      <div className="mt-6 space-y-3 rounded-xl border p-4">
        <div>
          <div className="text-sm text-gray-500">Phase</div>
          <div className="text-lg">{data.phase}</div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-sm text-gray-500">Primary slot</div>
            <div className="text-base">{data.primary_slot ?? "TBD"}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Secondary slot</div>
            <div className="text-base">{data.secondary_slot ?? "TBD"}</div>
          </div>
        </div>

        <div>
          <div className="text-sm text-gray-500">Next update by</div>
          <div className="text-base">{prettyDate(data.next_update_by)}</div>
        </div>

        <div>
          <div className="text-sm text-gray-500">Announcement</div>
          <div className="text-base whitespace-pre-wrap">
            {data.announcement ?? ""}
          </div>
        </div>

        <div className="pt-2 text-xs text-gray-500">
          Last updated: {prettyDate(data.updated_at)}
          {data.updated_by ? ` by ${data.updated_by}` : ""}
        </div>
      </div>
    </main>
  );
}