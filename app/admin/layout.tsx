import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAuthUserSafe, trySupabaseServer } from "@/lib/supabase/server";
import { trySupabaseService } from "@/lib/supabase/service";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Ensure this layout runs at request time (not during `next build` static generation),
  // since auth/admin checks require runtime env + cookies.
  await connection();

  const supabase = await trySupabaseServer();
  if (!supabase) {
    redirect("/login?next=" + encodeURIComponent("/admin"));
  }

  const user = await getAuthUserSafe(supabase);
  if (!user) {
    redirect("/login?next=" + encodeURIComponent("/admin"));
  }

  const service = trySupabaseService();
  if (!service) {
    redirect("/");
  }

  const { data: prof } = await service
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!prof?.is_admin) {
    redirect("/");
  }

  return <AdminShell>{children}</AdminShell>;
}
