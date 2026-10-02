import type { ReactNode } from "react";

/** Matches tournament hub overview stat cells. */
export function PickupStatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <div className="text-caption font-semibold text-muted">
        {label}
      </div>
      <div className="mt-2 text-h3 font-serif font-semibold text-ink sm:text-h2">{value}</div>
    </div>
  );
}
