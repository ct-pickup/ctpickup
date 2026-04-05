"use client";

import Link from "next/link";
import { useState } from "react";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

type Props = {
  token: string;
  onClose: () => void;
  /** Called after the server records acceptance for the current version. */
  onAccepted: () => void;
};

/**
 * Blocks tournament captain, pickup participation, and guidance flows until the user
 * accepts the current waiver version.
 */
export function WaiverAcceptanceModal({ token, onClose, onAccepted }: Props) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/waiver/accept", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ acknowledge: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(
          typeof j?.error === "string"
            ? j.error.replace(/_/g, " ")
            : "Could not save acceptance. Try again."
        );
        return;
      }
      onAccepted();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-5 py-8">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-[#141415] p-6 shadow-2xl">
        <h2 className="text-lg font-semibold uppercase tracking-tight text-white">
          Liability waiver required
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Our participation agreement was updated or you have not accepted the current
          version ({CURRENT_WAIVER_VERSION}). Review the full waiver, then confirm below
          to continue.
        </p>
        <p className="mt-4">
          <Link
            href="/liability-waiver"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Read Liability Waiver &amp; Participation Agreement
          </Link>
        </p>
        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-white/30 bg-black"
          />
          <span>
            I have read the Liability Waiver &amp; Participation Agreement and agree to
            its terms, including eligibility (13+; parental consent if under 18).
          </span>
        </label>
        {error ? (
          <p className="mt-4 text-sm font-medium text-red-300/95">{error}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!checked || busy}
            className="rounded-md bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Accept & continue"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
