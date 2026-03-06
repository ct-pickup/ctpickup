import Link from "next/link";
import PageTop from "@/components/PageTop";

export default function PickupStatusPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <PageTop title="STATUS" />
      <div className="mx-auto max-w-6xl px-6 py-14 space-y-10">

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
            Pickup Status
          </div>
          <div className="mt-4 text-lg font-semibold text-white/90">
            There are currently no updates.
          </div>
          <div className="mt-2 text-sm text-white/60">
            Updates will be posted here when runs are confirmed or modified.
          </div>
        </section>
      </div>
    </main>
  );
}
