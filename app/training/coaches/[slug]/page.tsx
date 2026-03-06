import Link from "next/link";
import { TRAINING_COACHES } from "@/lib/trainingCoaches";

export default function CoachInfoPage({ params }: { params: { slug: string } }) {
  const slug = (params.slug || "").toLowerCase().trim();
  const coach = TRAINING_COACHES.find((c) => (c.slug || "").toLowerCase().trim() === slug);

  if (!coach) {
    return (
      <main className="min-h-screen bg-white text-black">
        <div className="mx-auto max-w-3xl px-6 py-14 space-y-4">
          <div className="text-2xl font-semibold">Coach not found</div>
          <div className="text-sm text-black/60">Slug: {slug}</div>
          <div className="text-sm text-black/60">
            Available: {TRAINING_COACHES.map((c) => c.slug).filter(Boolean).join(", ")}
          </div>
          <Link href="/training" className="text-sm hover:underline underline-offset-4">
            Back to Training
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-3xl px-6 py-14 space-y-8">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-semibold uppercase tracking-tight">{coach.name}</div>
          <Link href="/training" className="text-sm text-black/70 hover:text-black hover:underline underline-offset-4">
            Back
          </Link>
        </div>

        {/* Photo on white */}
        <div className="rounded-2xl border border-black/10 overflow-hidden bg-white">
          {coach.photoSrc ? (
            <img src={coach.photoSrc} alt={coach.name} className="w-full h-auto object-cover" />
          ) : (
            <div className="h-[360px] bg-black/5" />
          )}
        </div>

        {/* Details on dark */}
        <div className="rounded-2xl bg-black text-white p-6 space-y-6">
          <div className="space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/70">Experience</div>
            <ul className="list-disc pl-5 space-y-1 text-white/85">
              {coach.details.experience.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/70">Coaching</div>
            <ul className="list-disc pl-5 space-y-1 text-white/85">
              {coach.details.coaching.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold uppercase tracking-wide text-white/70">Location</div>
            <div className="text-white/85">{coach.details.location}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
