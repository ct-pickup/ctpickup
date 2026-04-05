import { redirect } from "next/navigation";
import { supabaseService } from "@/lib/supabase/service";
import { HistoryBack } from "@/components/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RunIndexPage() {
  const supabase = supabaseService();

  const { data, error } = await supabase
    .from("events")
    .select("id,status,created_at")
    .eq("type", "pickup")
    .in("status", ["active", "locked"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return (
      <main className="min-h-screen p-6">
        <HistoryBack
          fallbackHref="/status/pickup"
          className="mb-4 shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
        />
        <h1 className="text-2xl font-semibold">No active run</h1>
        <p className="mt-2 text-sm text-gray-600">Admin needs to create one.</p>
      </main>
    );
  }

  redirect(`/run/${data.id}`);
}