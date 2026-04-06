"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { OperatorActionResult } from "@/components/admin/OperatorActionResult";

export function PromotePickupRunButton({
  runId,
  title,
  onApplied,
}: {
  runId: string;
  title?: string | null;
  onApplied: () => void;
}) {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function apply() {
    setResult(null);
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/operator", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_hub_pickup", run_id: runId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResult({ ok: false, error: typeof j?.error === "string" ? j.error : "Failed" });
      } else {
        setResult(j);
        setConfirm(false);
        onApplied();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!isReady) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      <div className="text-sm font-semibold text-white">Pickup hub</div>
      <p className="text-xs text-white/55">
        Make <span className="text-white/85">{title || runId}</span> the run players see on the pickup hub, RSVPs, and
        related pages.
      </p>
      <label className="flex items-center gap-2 text-xs text-white/65">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        Public pickup hub will switch to this run.
      </label>
      <button
        type="button"
        disabled={busy || !confirm}
        onClick={() => void apply()}
        className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"
      >
        {busy ? "Applying…" : "Make this the hub run"}
      </button>
      {result ? (
        <OperatorActionResult
          ok={!!result.ok}
          error={typeof result.error === "string" ? result.error : null}
          effects={result.effects as { record: string; detail: string }[] | undefined}
          verify={result.verify as { label: string; href: string }[] | undefined}
        />
      ) : null}
    </div>
  );
}
