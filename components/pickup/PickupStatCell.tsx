import type { ReactNode } from "react";

/** Matches tournament hub overview stat cells (`border-white/15`, label tracking). */
export function PickupStatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">{value}</div>
    </div>
  );
}
