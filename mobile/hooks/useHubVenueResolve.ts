import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { clampMaxDriveMinutes, DEFAULT_MAX_DRIVE_MINUTES } from "@/lib/accountHelpers";
import { siteOrigin } from "@/lib/env";
import { getNearestVenues, getNearestVenuesFromApi, type VenueDistanceRow } from "@/lib/venueDistance";

type HubProfile = {
  zip_code: string | null;
  nearest_venue: string | null;
  max_drive_minutes: number | null;
};

/**
 * When a profile has a ZIP but no nearest venue yet, pick the closest venue within the drive limit and save it.
 * `onResolved` receives the saved venue so the caller can patch its local profile.
 */
export function useHubVenueResolve(profile: HubProfile | null, onResolved: (venue: string) => void) {
  const { session, supabase, isReady } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [hubRegionResolving, setHubRegionResolving] = useState(false);
  const [hubVenueResolveDone, setHubVenueResolveDone] = useState(false);
  const hubResolveKeyRef = useRef<string | null>(null);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  useEffect(() => {
    setHubVenueResolveDone(false);
    hubResolveKeyRef.current = null;
  }, [profile?.zip_code]);

  useEffect(() => {
    if (!profile || !isReady || !supabase) return;
    const uid = session?.user?.id;
    if (!uid) return;

    const zip = String(profile.zip_code ?? "")
      .replace(/\D/g, "")
      .slice(0, 5);
    if (zip.length !== 5) return;
    if (String(profile.nearest_venue ?? "").trim()) {
      setHubVenueResolveDone(true);
      return;
    }

    if (hubResolveKeyRef.current === zip) return;
    hubResolveKeyRef.current = zip;

    let cancelled = false;
    void (async () => {
      setHubRegionResolving(true);
      try {
        const maxMin =
          profile.max_drive_minutes == null
            ? DEFAULT_MAX_DRIVE_MINUTES
            : clampMaxDriveMinutes(Number(profile.max_drive_minutes));
        let nearestVenues: VenueDistanceRow[] = [];
        const origin = siteOrigin();
        if (origin) {
          try {
            nearestVenues = await getNearestVenuesFromApi(zip, origin, accessToken);
          } catch (e) {
            console.error("[account] hub resolve getNearestVenuesFromApi", e);
          }
        }
        if (nearestVenues.length === 0) {
          nearestVenues = getNearestVenues(zip);
        }
        const within = nearestVenues.filter((r) => r.estimatedMinutes <= maxMin);
        const nearestVenue = within[0]?.venue ?? null;
        if (cancelled) return;
        if (!nearestVenue) {
          setHubVenueResolveDone(true);
          return;
        }

        const updatedAt = new Date().toISOString();
        let saved = false;
        if (origin && accessToken) {
          try {
            const r = await fetch(`${origin}/api/account/profile`, {
              method: "PATCH",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ nearest_venue: nearestVenue, updated_at: updatedAt }),
              cache: "no-store",
            });
            if (r.ok) saved = true;
          } catch (e) {
            console.error("[account] hub resolve PATCH profile", e);
          }
        }
        if (!saved) {
          try {
            const { error } = await supabase
              .from("profiles")
              .update({ nearest_venue: nearestVenue, updated_at: updatedAt })
              .eq("id", uid);
            if (error) {
              console.error("[account] hub resolve supabase update", JSON.stringify(error));
              setHubVenueResolveDone(true);
              return;
            }
          } catch (e) {
            console.error("[account] hub resolve supabase exception", e);
            setHubVenueResolveDone(true);
            return;
          }
        }
        onResolvedRef.current(nearestVenue);
        setHubVenueResolveDone(true);
      } catch (e) {
        console.error("[account] hub resolve exception", e);
        setHubVenueResolveDone(true);
      } finally {
        if (!cancelled) setHubRegionResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, isReady, supabase, session?.user?.id, accessToken]);

  return { hubRegionResolving, hubVenueResolveDone };
}
