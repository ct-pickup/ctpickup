import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=" + encodeURIComponent("/admin"));
  }

  const { data: prof } = await supabaseService()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof?.is_admin) {
    redirect("/");
  }

  return <AdminShell>{children}</AdminShell>;
}
