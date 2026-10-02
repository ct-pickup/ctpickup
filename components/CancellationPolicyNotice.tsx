"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { trySupabaseBrowser } from "@/lib/supabase/client";

const STORAGE_KEY_PREFIX = "ctpickup_cancellation_policy_notice_v1:";
const SEEN_COLUMN = "cancellation_policy_notice_seen_at";
/** Accounts created after this signed up under the new policy and never need the notice. */
const POLICY_EFFECTIVE_AT_MS = Date.parse("2026-10-03T04:00:00Z");
const HIDDEN_PATHS = ["/login", "/signup", "/onboarding", "/after-login"];

type LocalSeen = "seen" | "unseen" | "unknown";

function readLocalSeen(userId: string): LocalSeen {
  try {
    return window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`) === "1" ? "seen" : "unseen";
  } catch {
    return "unknown";
  }
}

function writeLocalSeen(userId: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, "1");
  } catch {
    /* ignore */
  }
}

async function markSeenRemote(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    await supabase
      .from("profiles")
      .update({ [SEEN_COLUMN]: new Date().toISOString() })
      .eq("id", userId)
      .is(SEEN_COLUMN, null);
  } catch {
    /* column may not exist yet; the local flag covers it */
  }
}

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204" || (error.message ?? "").includes(SEEN_COLUMN);
}

function createdAfterPolicy(createdAt: unknown): boolean {
  if (typeof createdAt !== "string") return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= POLICY_EFFECTIVE_AT_MS;
}

async function shouldShowNotice(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const local = readLocalSeen(userId);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(`${SEEN_COLUMN}, created_at`)
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      if (!isMissingColumnError(error) || local !== "unseen") return false;
      const fallback = await supabase.from("profiles").select("created_at").eq("id", userId).maybeSingle();
      if (fallback.error || !fallback.data) return false;
      if (createdAfterPolicy((fallback.data as { created_at?: unknown }).created_at)) {
        writeLocalSeen(userId);
        return false;
      }
      return true;
    }
    if (!data) return false;

    const row = data as Record<string, unknown>;
    if (row[SEEN_COLUMN]) {
      if (local === "unseen") writeLocalSeen(userId);
      return false;
    }
    if (local === "seen" || createdAfterPolicy(row.created_at)) {
      writeLocalSeen(userId);
      await markSeenRemote(supabase, userId);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** One-time notice about the October 2026 cancellation policy change for signed-in users. */
export function CancellationPolicyNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [visibleFor, setVisibleFor] = useState<string | null>(null);
  const checkedForRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = trySupabaseBrowser();
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null))
      .catch(() => {});
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const supabase = trySupabaseBrowser();
    if (!supabase || !userId || checkedForRef.current === userId) return;
    checkedForRef.current = userId;
    void shouldShowNotice(supabase, userId).then((show) => {
      if (show) setVisibleFor(userId);
    });
  }, [userId]);

  const dismiss = useCallback(
    (openTerms: boolean) => {
      const id = visibleFor;
      setVisibleFor(null);
      if (id) {
        writeLocalSeen(id);
        const supabase = trySupabaseBrowser();
        if (supabase) void markSeenRemote(supabase, id);
      }
      if (openTerms) router.push("/terms");
    },
    [router, visibleFor],
  );

  if (!visibleFor || visibleFor !== userId) return null;
  if (HIDDEN_PATHS.some((p) => pathname === p || pathname?.startsWith(`${p}/`))) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-5 py-8">
      <div className="absolute inset-0 bg-scrim" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancellation-policy-notice-title"
        className="relative z-10 w-full max-w-md rounded-card border border-line bg-canvas p-6"
      >
        <h2 id="cancellation-policy-notice-title" className="text-h3 font-serif font-semibold text-ink">
          Cancellation policy
        </h2>
        <p className="mt-3 text-small leading-relaxed text-muted">
          We updated our cancellation policy. Leaving 24+ hours before kickoff now gives you a credit instead of a
          refund.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="rounded-button border border-line px-5 py-2.5 text-small font-semibold text-ink hover:bg-overlay-subtle"
          >
            View terms
          </button>
          <button
            type="button"
            onClick={() => dismiss(false)}
            className="rounded-button bg-pitch px-5 py-2.5 text-small font-semibold text-on-pitch"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
