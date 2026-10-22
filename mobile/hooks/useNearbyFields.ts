import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import type { MapRegion } from "@/lib/fields/listings";
import { nearbyKey } from "@/lib/fields/nearby";
import { fetchNearby } from "@/lib/fields/nearbyApi";
import type { FieldFilters, FieldListing } from "@/lib/fields/types";

const FIRST_PAGE = 200;
const NEXT_PAGE = 100;
const DEBOUNCE_MS = 350;

type Args = {
  region: MapRegion | null;
  user: { lat: number; lon: number } | null;
  filters: FieldFilters;
  /** False until the starting map position is known. */
  enabled: boolean;
  /** Called with a search's first results (not for later pages), so the map can move to them. */
  onSearchResults?: (items: FieldListing[], query: string) => void;
};

/**
 * Venues for the Fields list and map, fetched from the database for the visible map area and the chips as they change
 * (debounced), instead of loading every venue. `total` is the full match count for "N fields near you".
 */
export function useNearbyFields({ region, user, filters, enabled, onSearchResults }: Args) {
  const { supabase, session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [items, setItems] = useState<FieldListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const keyRef = useRef("");
  const latest = useRef({ region, user, filters, onSearchResults });
  useEffect(() => {
    latest.current = { region, user, filters, onSearchResults };
  });

  const key = nearbyKey({ region, user, filters });

  useEffect(() => {
    if (!enabled || !supabase || !uid) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const a = latest.current;
      keyRef.current = key;
      setLoading(true);
      try {
        const res = await fetchNearby(supabase, { region: a.region, user: a.user, filters: a.filters, limit: FIRST_PAGE, offset: 0 });
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setError(null);
        const q = a.filters.query.trim();
        if (q && res.items.length > 0) a.onSearchResults?.(res.items, q);
      } catch {
        if (!cancelled) setError("We couldn’t load fields. Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, supabase, uid, key, retry]);

  /** The next page of the same request. Ignored if the map or chips moved on in the meantime. */
  const loadMore = useCallback(async () => {
    if (!supabase || items.length >= total) return;
    const at = keyRef.current;
    const a = latest.current;
    try {
      const res = await fetchNearby(supabase, { region: a.region, user: a.user, filters: a.filters, limit: NEXT_PAGE, offset: items.length });
      if (keyRef.current !== at) return;
      setItems((cur) => [...cur, ...res.items]);
    } catch {
      setError("We couldn’t load more fields. Try again.");
    }
  }, [supabase, items.length, total]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);

  return { items, total, loading, error, loadMore, reload, hasMore: items.length < total };
}
