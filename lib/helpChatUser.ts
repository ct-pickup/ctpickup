import { createClient } from "@supabase/supabase-js";

/** Resolve signed-in user admin flag for help chat (nav whitelist + API sanitization). */
export async function resolveHelpChatUser(
  req: Request
): Promise<{ isAdmin: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization");
  if (!url || !anon || !auth?.startsWith("Bearer ")) {
    return { isAdmin: false };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
  });

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return { isAdmin: false };

  const { data: row } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  return { isAdmin: !!row?.is_admin };
}
