"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { PROFILE_UPDATED_EVENT } from "@/lib/profileBroadcast";
import { isMissingProfileColumnError } from "@/lib/profileLoad";
import { esportsProfileNudgeCopy } from "@/lib/profilePreferences";

const HIDE_PREFIXES = [
  "/profile",
  "/signup",
  "/login",
  "/onboarding",
  "/terms",
  "/privacy",
  "/liability-waiver",
] as const;

function shouldShowBar(pathname: string) {
  return !HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Slim reminder when online-tournament preference is unset or deferred — visible on main app pages, not only on Profile.
 */
export function EsportsSetupNudgeBar() {
  const pathname = usePathname() || "";
  const { supabase, isReady } = useSupabaseBrowser();
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isReady || !supabase || !shouldShowBar(pathname)) {
      setShow(false);
      setMessage(null);
      return;
    }

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth.user;
    if (authErr || !user) {
      setShow(false);
      setMessage(null);
      return;
    }

    const r = await supabase
      .from("profiles")
      .select("esports_interest, esports_platform, esports_console, esports_online_id")
      .eq("id", user.id)
      .maybeSingle();

    if (r.error) {
      if (isMissingProfileColumnError(r.error.message)) {
        setShow(false);
        setMessage(null);
        return;
      }
      setShow(false);
      setMessage(null);
      return;
    }

    const row = r.data;
    const copy = row ? esportsProfileNudgeCopy(row) : null;
    if (!copy) {
      setShow(false);
      setMessage(null);
      return;
    }

    setMessage(copy);
    setShow(true);
  }, [isReady, supabase, pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => void refresh();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdated);
  }, [refresh]);

  if (!show || !message) return null;

  return (
    <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.09] px-3 py-2.5 sm:px-4">
      <p className="text-center text-xs leading-relaxed text-amber-50/95 sm:text-left">
        <span className="font-medium text-amber-100">Profile:</span> {message}{" "}
        <Link
          href="/profile"
          className="font-semibold text-white underline-offset-4 hover:underline"
        >
          Open Profile
        </Link>
      </p>
    </div>
  );
}
