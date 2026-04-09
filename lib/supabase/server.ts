import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * Server-side `getUser()` without throwing: avoids crashes when Auth returns an
 * unexpected shape or the network fails. Use for Server Components / layouts.
 */
export async function getAuthUserSafe(client: SupabaseClient): Promise<User | null> {
  try {
    const { data } = await client.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort server client. Returns null when Supabase public env vars
 * are missing (common during misconfigured deploys), so public pages can still render.
 */
export async function trySupabaseServer() {
  try {
    const env = getSupabasePublicEnv();
    if (!env) return null;

    const cookieStore = await cookies();

    return createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        /**
         * Must not call `cookies().set` here. Supabase invokes this asynchronously during
         * auth refresh; Next.js only allows cookie mutation in Server Actions / Route Handlers,
         * not in RSC. Unhandled rejections were: "Cookies can only be modified in a Server Action..."
         * Session refresh + Set-Cookie runs in `proxy.ts` before RSC.
         */
        setAll: async () => {},
      },
    });
  } catch {
    return null;
  }
}

export async function supabaseServer() {
  const env = getSupabasePublicEnv();
  if (!env) {
    throw new Error(
      "Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY).",
    );
  }
  const cookieStore = await cookies();

  return createServerClient(
    env.url,
    env.anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies during render; middleware refreshes the session.
          }
        },
      },
    }
  );
}
