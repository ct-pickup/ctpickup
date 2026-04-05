"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trySupabaseBrowser } from "./client";

export type SupabaseBrowserState = {
  /** Null until mounted; null after mount if env is missing or init failed. */
  supabase: SupabaseClient | null;
  /** True after the client mount attempt has finished (success or failure). */
  isReady: boolean;
};

/**
 * Browser Supabase client is created once after mount (in `useEffect` only), stored in a ref,
 * and exposed as `supabase` only after `isReady` so it is never created during render or `useMemo`.
 */
export function useSupabaseBrowser(): SupabaseBrowserState {
  const clientRef = useRef<SupabaseClient | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    clientRef.current = trySupabaseBrowser();
    setIsReady(true);
  }, []);

  return {
    supabase: isReady ? clientRef.current : null,
    isReady,
  };
}
