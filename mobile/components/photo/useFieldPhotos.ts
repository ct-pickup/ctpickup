import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { fetchFieldPhotoUrls } from "@/lib/photoUpload";

/** Field photo URLs keyed by run id for the given runs. */
export function useFieldPhotos(runIds: string[]): Record<string, string> {
  const { supabase } = useAuth();
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const key = Array.from(new Set(runIds)).sort().join(",");

  useEffect(() => {
    if (!supabase || !key) {
      setPhotos({});
      return;
    }
    let cancelled = false;
    void fetchFieldPhotoUrls(supabase, key.split(",")).then((map) => {
      if (!cancelled) setPhotos(map);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, key]);

  return photos;
}
