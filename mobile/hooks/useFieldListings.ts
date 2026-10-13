import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { SAMPLE_FIELDS } from "@/lib/fields/sampleData";
import type { FieldListing } from "@/lib/fields/types";
import { getCachedListing, loadFieldListing, loadFieldListings, quietUserLocation } from "@/lib/fields/venueStore";

/** Every venue for the Fields list and map, loaded once from the venues table. */
export function useFieldListings() {
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [fields, setFields] = useState<FieldListing[]>(() => (FIELDS_SAMPLE_DATA ? SAMPLE_FIELDS : []));
  const [loading, setLoading] = useState(!FIELDS_SAMPLE_DATA);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ lat: number; lon: number } | null>(null);

  const load = useCallback(async () => {
    if (FIELDS_SAMPLE_DATA) return;
    if (!supabase || !uid) {
      setLoading(false);
      return;
    }
    try {
      const where = await quietUserLocation();
      setUser(where);
      setFields(await loadFieldListings(supabase, where));
      setError(null);
    } catch {
      setError("We couldn’t load fields. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [supabase, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  return { fields, loading, error, user, reload: load };
}

/** One field by key: from the loaded list when there, otherwise fetched. */
export function useFieldListing(key: string | null | undefined) {
  const { supabase } = useAuth();
  const [state, setState] = useState<{ listing: FieldListing | null; loading: boolean }>(() => {
    const hit = getCachedListing(key);
    return { listing: hit, loading: !hit && !!key };
  });

  useEffect(() => {
    if (!key || !supabase || state.listing) return;
    let cancelled = false;
    void loadFieldListing(supabase, key).then((l) => {
      if (!cancelled) setState({ listing: l, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [key, supabase, state.listing]);

  return state;
}

