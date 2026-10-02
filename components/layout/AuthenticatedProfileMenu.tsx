"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PROFILE_UPDATED_EVENT } from "@/lib/profileBroadcast";
import { loadProfileRowForUser } from "@/lib/profileLoad";
import { esportsFlowNeedsAttention } from "@/lib/profilePreferences";
import { HAS_EVER_SIGNED_UP_KEY, signupUrlForIntent } from "@/lib/auth/signupIntent";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";

function UserGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className ?? "text-muted"}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M20 21a8 8 0 0 0-16 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Top-bar account control: logged out → “Log in”; logged in → avatar (photo or placeholder) linking to `/profile`.
 * Uses `getUser()` (validated JWT) instead of `getSession()` so cookie-based SSR clients don’t look logged out.
 */
export function AuthenticatedProfileMenu({
  guestCtaMode = "signupFirst",
}: {
  /**
   * - `login` (default): logged-out users see “Log in”.
   * - `signupFirst`: logged-out users see “Sign up” until this browser successfully completed signup once.
   */
  guestCtaMode?: "login" | "signupFirst";
}) {
  const { supabase, isReady } = useSupabaseBrowser();
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [esportsIncomplete, setEsportsIncomplete] = useState(false);
  const [hasEverSignedUp, setHasEverSignedUp] = useState<boolean>(false);

  useEffect(() => {
    if (guestCtaMode !== "signupFirst") return;
    try {
      setHasEverSignedUp(
        typeof window !== "undefined" &&
          window.localStorage.getItem(HAS_EVER_SIGNED_UP_KEY) === "1",
      );
    } catch {
      setHasEverSignedUp(false);
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;

    if (!supabase) {
      setUserId(null);
      setAvatarUrl(null);
      setEsportsIncomplete(false);
      setReady(true);
      return;
    }

    const client = supabase;

    const load = async () => {
      const { data, error } = await client.auth.getUser();
      const user = data.user;
      if (error || !user) {
        setUserId(null);
        setAvatarUrl(null);
        setEsportsIncomplete(false);
        setReady(true);
        return;
      }

      setUserId(user.id);

      const res = await loadProfileRowForUser(client, user.id);
      const p = res.row;
      setAvatarUrl(p?.avatar_url?.trim() || null);
      setAvatarBroken(false);
      setEsportsIncomplete(
        res.hasEsportsSchema &&
          Boolean(p && esportsFlowNeedsAttention(p)),
      );
      setReady(true);
    };

    loadRef.current = load;

    void load();
    const { data: sub } = client.auth.onAuthStateChange(() => {
      void load();
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, isReady]);

  useEffect(() => {
    const onUpdated = () => {
      void loadRef.current();
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdated);
  }, []);

  if (!isReady || !ready) {
    return (
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-muted lg:h-9 lg:w-9 lg:border lg:border-line lg:bg-overlay-subtle"
        aria-busy="true"
        aria-label="Loading account"
      >
        <UserGlyph className="text-muted" />
      </div>
    );
  }

  if (!userId) {
    const showSignupFirst = guestCtaMode === "signupFirst";
    const href =
      showSignupFirst && !hasEverSignedUp
        ? signupUrlForIntent("pickup")
        : "/login";
    const label =
      showSignupFirst && !hasEverSignedUp
        ? "Sign up"
        : "Log in";
    return (
      <Link
        href={href}
        className="flex min-h-[44px] shrink-0 items-center rounded-button px-2 text-small font-semibold text-ink transition-colors hover:bg-overlay-subtle hover:text-ink active:bg-overlay lg:h-9 lg:min-h-0 lg:rounded-pill lg:border lg:border-line lg:bg-overlay lg:px-3 lg:py-1.5 lg:text-small lg:font-medium lg:hover:bg-overlay-strong"
      >
        {label}
      </Link>
    );
  }

  const showImg = Boolean(avatarUrl) && !avatarBroken;

  return (
    <Link
      href="/profile"
      title={esportsIncomplete ? "Profile — finish online tournament preference" : undefined}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-pill text-ink transition-colors hover:bg-overlay hover:text-ink active:bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:h-9 lg:w-9 lg:border lg:border-line lg:bg-overlay lg:hover:bg-overlay-strong"
      aria-label={
        esportsIncomplete
          ? "Your profile — finish online tournament setup"
          : "Your profile"
      }
    >
      {esportsIncomplete ? (
        <span
          className="pointer-events-none absolute right-0 top-0 z-[1] h-2.5 w-2.5 rounded-pill bg-coral"
          aria-hidden
        />
      ) : null}
      {showImg ? (
        <img
          src={avatarUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setAvatarBroken(true)}
        />
      ) : (
        <UserGlyph className="text-muted" />
      )}
    </Link>
  );
}
