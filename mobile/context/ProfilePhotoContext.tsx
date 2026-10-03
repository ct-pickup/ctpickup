import { usePathname } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import ProfilePhotoSheet, { type PhotoSheetReason } from "@/components/photo/ProfilePhotoSheet";
import { useAuth } from "@/context/AuthContext";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useWaiver } from "@/context/WaiverContext";
import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { fetchProfilePhotoStatus } from "@/lib/profilePhoto";
import { hasProfilePhoto, PHOTO_REQUIRED_CODE } from "@shared/profilePhoto";

type ProfilePhotoContextValue = {
  /** Server flag REQUIRE_PROFILE_PHOTO. When false nothing is blocked; the sheet still nudges. */
  required: boolean;
  avatarUrl: string | null;
  /** null while unknown (loading or lookup failed). */
  hasPhoto: boolean | null;
  setAvatarUrl: (url: string | null) => void;
  openPhotoSheet: (reason: PhotoSheetReason) => void;
  /** True when the player may join or host. Otherwise opens the sheet and returns false. */
  ensurePhotoForGame: () => boolean;
  /** Opens the sheet when an API response is 403 photo_required. Returns true if it handled the response. */
  handlePhotoRequired: (status: number, json: unknown) => boolean;
  /** True while the photo sheet is open (other first-run prompts wait for it). */
  sheetOpen: boolean;
  /** Stops the automatic sheet for the rest of this launch and for 7 days (signup "Not now"). */
  dismissNudge: () => void;
};

const ProfilePhotoContext = createContext<ProfilePhotoContextValue | undefined>(undefined);

/** The nudge sheet (not the "removed" one) shows at most once per this long. */
const NUDGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const NUDGE_LAST_SHOWN_KEY = "ctpickup_photo_nudge_last_shown_v1";

async function stampNudge(): Promise<void> {
  try {
    await appAsyncStorage.setItem(NUDGE_LAST_SHOWN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

const NO_AUTO_SHEET_PATHS = ["/login", "/waiver", "/complete-profile", "/onboarding", "/reset-password"];

export function ProfilePhotoProvider({ children }: { children: React.ReactNode }) {
  const { session, supabase, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();
  const pathname = usePathname();
  const userId = session?.user?.id ?? null;
  const token = session?.access_token ?? null;

  const [required, setRequired] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [avatarUrl, setAvatarUrlState] = useState<string | null>(null);
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [sheet, setSheet] = useState<PhotoSheetReason | null>(null);
  const nudged = useRef(false);
  /** null until the last-shown stamp has been read. */
  const [nudgeDue, setNudgeDue] = useState<boolean | null>(null);
  const removedShown = useRef(false);

  const refresh = useCallback(async () => {
    if (!supabase || !userId) {
      setHasPhoto(null);
      setAvatarUrlState(null);
      return;
    }
    const [status, prof] = await Promise.all([
      fetchProfilePhotoStatus(token),
      supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle(),
    ]);
    setRequired(status.required);
    setRemoved(status.removed);
    if (prof.error) {
      setHasPhoto(status.hasPhoto);
      return;
    }
    const url = (prof.data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    setAvatarUrlState(url);
    setHasPhoto(hasProfilePhoto(url));
  }, [supabase, userId, token]);

  useEffect(() => {
    nudged.current = false;
    removedShown.current = false;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void appAsyncStorage
      .getItem(NUDGE_LAST_SHOWN_KEY)
      .then((raw) => {
        if (cancelled) return;
        const last = raw ? Number(raw) : NaN;
        setNudgeDue(!Number.isFinite(last) || Date.now() - last >= NUDGE_INTERVAL_MS);
      })
      .catch(() => {
        if (!cancelled) setNudgeDue(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const gatesPassed = isReady && !!userId && !waiverLoading && waiverAccepted && !profileGateLoading && !profileNeedsCompletion;

  useEffect(() => {
    if (!gatesPassed || hasPhoto !== false || sheet) return;
    if (NO_AUTO_SHEET_PATHS.some((p) => pathname?.startsWith(p))) return;
    if (removed && !removedShown.current) {
      removedShown.current = true;
      nudged.current = true;
      setSheet("removed");
      return;
    }
    if (!nudged.current && nudgeDue === true) {
      nudged.current = true;
      void stampNudge();
      setSheet("nudge");
    }
  }, [gatesPassed, hasPhoto, removed, sheet, pathname, nudgeDue]);

  const setAvatarUrl = useCallback((url: string | null) => {
    setAvatarUrlState(url);
    setHasPhoto(hasProfilePhoto(url));
    if (url) setRemoved(false);
  }, []);

  const openPhotoSheet = useCallback((reason: PhotoSheetReason) => setSheet(reason), []);
  const dismissNudge = useCallback(() => {
    nudged.current = true;
    void stampNudge();
  }, []);

  const ensurePhotoForGame = useCallback(() => {
    if (!required || hasPhoto !== false) return true;
    setSheet("blocked");
    return false;
  }, [required, hasPhoto]);

  const handlePhotoRequired = useCallback((status: number, json: unknown) => {
    const code = json && typeof json === "object" ? (json as { code?: unknown }).code : null;
    if (status !== 403 || code !== PHOTO_REQUIRED_CODE) return false;
    setRequired(true);
    setHasPhoto(false);
    setSheet("blocked");
    return true;
  }, []);

  const value = useMemo(
    () => ({ required, avatarUrl, hasPhoto, sheetOpen: sheet !== null, setAvatarUrl, openPhotoSheet, ensurePhotoForGame, handlePhotoRequired, dismissNudge }),
    [required, avatarUrl, hasPhoto, sheet, setAvatarUrl, openPhotoSheet, ensurePhotoForGame, handlePhotoRequired, dismissNudge],
  );

  return (
    <ProfilePhotoContext.Provider value={value}>
      {children}
      <ProfilePhotoSheet
        reason={sheet}
        avatarUrl={avatarUrl}
        onSaved={(url) => {
          setAvatarUrl(url);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
    </ProfilePhotoContext.Provider>
  );
}

export function useProfilePhoto() {
  const ctx = useContext(ProfilePhotoContext);
  if (!ctx) throw new Error("useProfilePhoto must be used within ProfilePhotoProvider");
  return ctx;
}
