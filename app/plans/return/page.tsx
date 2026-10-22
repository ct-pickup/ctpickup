import type { Metadata } from "next";

export const metadata: Metadata = { title: "Plan checkout" };

/** Where Stripe Checkout sends the player. The app's in-app browser sheet just needs a page to land on. */
export default async function PlansReturnPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ok = status === "success";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 bg-chalk px-6 text-center">
      <h1 className="text-h3 text-ink">{ok ? "You’re all set" : "Checkout canceled"}</h1>
      <p className="text-small text-muted">{ok ? "Your plan is being set up. Close this window to go back to the app." : "No charge was made. Close this window to go back to the app."}</p>
    </main>
  );
}
