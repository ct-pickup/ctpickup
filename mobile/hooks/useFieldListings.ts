import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import type { FieldListing } from "@/lib/fields/types";
import { getCachedListing, loadFieldListing } from "@/lib/fields/venueStore";

/** One field by key: from what the list or map already loaded, otherwise fetched. */
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
