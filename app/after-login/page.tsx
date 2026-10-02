import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AfterLoginPublicClient } from "./AfterLoginPublicClient";
import { getAuthUserSafe, trySupabaseServer } from "@/lib/supabase/server";
import { SITE_ORIGIN } from "@/lib/site";

export const dynamic = "force-dynamic";

const canonical = `${SITE_ORIGIN}/after-login`;

export const metadata: Metadata = {
  title: "Competitive Together member hub | ctpickup.net",
  description:
    "Sign in to Competitive Together at ctpickup.net — your hub for pickup soccer: games, tournaments, training, and community.",
  alternates: { canonical },
  openGraph: {
    title: "Competitive Together member hub | ctpickup.net",
    description:
      "Sign in to Competitive Together — your hub for pickup soccer and community.",
    url: canonical,
    siteName: "Competitive Together",
    type: "website",
  },
  robots: { index: true, follow: true },
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function buildSearchString(
  sp: Record<string, string | string[] | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
    else if (typeof v === "string") qs.set(k, v);
  }
  return qs.toString();
}

export default async function AfterLoginPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const suffix = buildSearchString(sp);
  const dashboardPath = suffix ? `/dashboard?${suffix}` : "/dashboard";

  const supabase = await trySupabaseServer();
  if (supabase) {
    const user = await getAuthUserSafe(supabase);
    if (user) {
      redirect(suffix ? `/dashboard?${suffix}` : "/dashboard");
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(dashboardPath)}`;

  return <AfterLoginPublicClient loginHref={loginHref} />;
}
