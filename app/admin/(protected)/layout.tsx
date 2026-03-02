import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
const supabase = await supabaseServer();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  if (!user?.email) redirect("/admin/login");

  const { data: allowlisted } = await supabase
    .from("admin_allowlist")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (!allowlisted) {
    await supabase.auth.signOut();
    redirect("/");
  }

  return <>{children}</>;
}
