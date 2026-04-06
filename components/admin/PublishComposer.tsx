"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusChip } from "@/components/admin/StatusChip";
import type { PreviewBlock } from "@/lib/admin/publish/buildPreview";
import type { PublishTargetsInput } from "@/lib/admin/publish/types";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

type RunOpt = { id: string; title: string | null; is_current?: boolean | null };

export function PublishComposer({
  runs,
  defaultRunIds,
  preselectRunIds = [],
  preselectTournament = false,
  hasActiveTournament,
}: {
  runs: RunOpt[];
  defaultRunIds: string[];
  /** Merged into selected runs (e.g. deep-link from Pickup admin). */
  preselectRunIds?: string[];
  /** Pre-check tournament target (from Tournament admin). */
  preselectTournament?: boolean;
  hasActiveTournament: boolean;
}) {
  const { supabase, isReady } = useSupabaseBrowser();
  const [message, setMessage] = useState("");
  const [siteStatus, setSiteStatus] = useState(false);
  const [pickupGlobal, setPickupGlobal] = useState(false);
  const [tournamentActive, setTournamentActive] = useState(false);
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(() => new Set(defaultRunIds));
  const [previews, setPreviews] = useState<PreviewBlock[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const idemRef = useRef<string | null>(null);

  useEffect(() => {
    const next = new Set<string>([...preselectRunIds, ...defaultRunIds]);
    setSelectedRuns(next);
  }, [defaultRunIds, preselectRunIds]);

  useEffect(() => {
    if (preselectTournament && hasActiveTournament) setTournamentActive(true);
  }, [preselectTournament, hasActiveTournament]);

  const buildTargets = useCallback((): PublishTargetsInput => {
    return {
      siteStatus,
      pickupGlobal,
      tournamentActive: hasActiveTournament && tournamentActive,
      pickupRunIds: Array.from(selectedRuns),
    };
  }, [siteStatus, pickupGlobal, tournamentActive, hasActiveTournament, selectedRuns]);

  const hasTarget = useCallback(() => {
    if (siteStatus || pickupGlobal) return true;
    if (hasActiveTournament && tournamentActive) return true;
    if (selectedRuns.size > 0) return true;
    return false;
  }, [siteStatus, pickupGlobal, hasActiveTournament, tournamentActive, selectedRuns]);

  const authHeader = useCallback(async () => {
    if (!supabase) return null;
    const s = await supabase.auth.getSession();
    return s.data.session?.access_token ?? null;
  }, [supabase]);

  const preview = async () => {
    setNote(null);
    if (!hasTarget()) {
      setNote("Choose at least one destination.");
      return;
    }
    const token = await authHeader();
    if (!token) {
      setNote("You need to be signed in.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/publish/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, targets: buildTargets() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPreviews(null);
        setNote(typeof j?.error === "string" ? j.error : "Preview failed.");
        return;
      }
      setPreviews(Array.isArray(j.previews) ? j.previews : []);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setNote(null);
    if (!hasTarget()) {
      setNote("Choose at least one destination.");
      return;
    }
    const token = await authHeader();
    if (!token) {
      setNote("You need to be signed in.");
      return;
    }
    if (!idemRef.current) {
      idemRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `pub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message,
          targets: buildTargets(),
          idempotency_key: idemRef.current,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote(typeof j?.error === "string" ? j.error : "Publish failed.");
        return;
      }
      const dup = j.duplicate === true;
      const failed = Array.isArray(j.deliveries)
        ? j.deliveries.filter((d: { sync_state?: string }) => d.sync_state === "failed").length
        : 0;
      setNote(
        dup
          ? "Already applied — nothing new was sent."
          : failed
            ? `Sent, but ${failed} destination(s) failed. Retry from Sync & status.`
            : "Published. Visitors will see updates on their next page load.",
      );
      if (j.revalidateError) {
        setNote((prev) => `${prev || ""} Page refresh job: ${j.revalidateError}`);
      }
      idemRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const toggleRun = (id: string) => {
    setSelectedRuns((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  if (!isReady) {
    return <p className="text-sm text-white/55">Loading session…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/45">Message</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="mt-2 w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none"
            placeholder="One message — choose where it should land."
          />
        </label>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Targets</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <input type="checkbox" checked={siteStatus} onChange={(e) => setSiteStatus(e.target.checked)} />
            <div>
              <div className="text-sm font-medium text-white">Site-wide status card</div>
              <p className="mt-1 text-xs text-white/50">Main announcement for help chat and staff — not the pickup post feed.</p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <input type="checkbox" checked={pickupGlobal} onChange={(e) => setPickupGlobal(e.target.checked)} />
            <div>
              <div className="text-sm font-medium text-white">Pickup · all players</div>
              <p className="mt-1 text-xs text-white/50">One post everyone following pickup sees.</p>
            </div>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 ${!hasActiveTournament ? "opacity-45" : ""}`}
          >
            <input
              type="checkbox"
              disabled={!hasActiveTournament}
              checked={tournamentActive && hasActiveTournament}
              onChange={(e) => setTournamentActive(e.target.checked)}
            />
            <div>
              <div className="text-sm font-medium text-white">Live tournament</div>
              <p className="mt-1 text-xs text-white/50">
                {hasActiveTournament
                  ? "Announcement on the tournament players see publicly."
                  : "No tournament is live — make one live in Tournaments first."}
              </p>
            </div>
          </label>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-medium text-white">Pickup runs (per-run posts)</div>
          <p className="mt-1 text-xs text-white/50">Adds a separate post for each run you check.</p>
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
            {runs.length === 0 ? (
              <li className="text-white/45">No runs.</li>
            ) : (
              runs.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-white/80">
                    <input type="checkbox" checked={selectedRuns.has(r.id)} onChange={() => toggleRun(r.id)} />
                    <span>{r.title || "Untitled"}</span>
                    {r.is_current ? <StatusChip tone="published">Hub</StatusChip> : null}
                  </label>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void preview()}
          className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
        >
          Preview destinations
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void publish()}
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          Publish once
        </button>
      </div>

      {note ? <p className="text-sm text-white/70">{note}</p> : null}

      {previews?.length ? (
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Preview</div>
          {previews.map((p) => (
            <div key={p.key} className="rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="text-sm font-semibold text-white">{p.title}</div>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-white/65 font-sans">{p.body}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
