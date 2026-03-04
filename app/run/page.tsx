import { redirect } from "next/navigation";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";

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
        <h1 className="text-2xl font-semibold">No active run</h1>
        <p className="mt-2 text-sm text-gray-600">Admin needs to create one.</p>
      </main>
    );
  }

  redirect(`/run/${data.id}`);
}