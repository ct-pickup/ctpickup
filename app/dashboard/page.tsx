import { redirect } from "next/navigation";
import AfterLoginClient from "../after-login/AfterLoginClient";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  return <AfterLoginClient />;
}

