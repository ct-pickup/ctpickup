"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { PROFILE_SELECT, type ProfileRow } from "@/lib/profileFields";
import { PROFILE_UPDATED_EVENT } from "@/lib/profileBroadcast";

function UserGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className ?? "text-white/75"}
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
export function AuthenticatedProfileMenu() {
  const { supabase, isReady } = useSupabaseBrowser();
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    if (!isReady) return;

    if (!supabase) {
      setUserId(null);
      setAvatarUrl(null);
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
        setReady(true);
        return;
      }

      setUserId(user.id);

      const { data: row } = await client
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("id", user.id)
        .maybeSingle();

      const p = row as ProfileRow | null;
      setAvatarUrl(p?.avatar_url?.trim() || null);
      setAvatarBroken(false);
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
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 lg:h-9 lg:w-9"
        aria-busy="true"
        aria-label="Loading account"
      >
        <UserGlyph className="text-white/25" />
      </div>
    );
  }

  if (!userId) {
    return (
      <Link
        href="/login"
        className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/[0.14] lg:h-9 lg:min-h-0 lg:px-3 lg:py-1.5"
      >
        Log in
      </Link>
    );
  }

  const showImg = Boolean(avatarUrl) && !avatarBroken;

  return (
    <Link
      href="/profile"
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 transition hover:bg-white/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 lg:h-9 lg:w-9"
      aria-label="Your profile"
    >
      {showImg ? (
        <img
          src={avatarUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setAvatarBroken(true)}
        />
      ) : (
        <UserGlyph className="text-white/70" />
      )}
    </Link>
  );
}
