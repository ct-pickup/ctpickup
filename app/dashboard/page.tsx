import { redirect } from "next/navigation";
import AfterLoginClient from "../after-login/AfterLoginClient";
import { markDashboardHomeSeen } from "@/lib/profile/markDashboardHomeSeen";
import { getAuthUserSafe, trySupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await trySupabaseServer();
  if (!supabase) {
    redirect("/login?next=/dashboard");
  }

  const user = await getAuthUserSafe(supabase);
  if (!user) {
    redirect("/login?next=/dashboard");
  }

  await markDashboardHomeSeen(user.id, supabase, { email: user.email });

  return <AfterLoginClient />;
}

