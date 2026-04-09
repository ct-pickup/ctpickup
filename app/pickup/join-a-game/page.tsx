import { redirect } from "next/navigation";

/** Canonical pickup listing + join flow lives at `/pickup/upcoming-games`. */
export default async function JoinAGameRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = sp.run;
  const run = Array.isArray(raw) ? raw[0] : raw;
  if (run) {
    redirect(`/pickup/upcoming-games?run=${encodeURIComponent(run)}`);
  }
  redirect("/pickup/upcoming-games");
}
