import { useReviewMode } from "@/context/ReviewModeContext";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";

/**
 * Whether the signed-in user is treated as approved on the client (chat, tournaments, etc.).
 * Review Mode bypasses the gate without changing Supabase.
 */
export function useProfileApproval() {
  const { supabase, session } = useAuth();
  const { enabled: reviewMode, isReady: reviewModeReady } = useReviewMode();
  const [approved, setApproved] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setApproved(null);
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("approved,is_admin")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      setIsAdmin(!!data?.is_admin);
      setApproved(data?.approved === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, session?.user?.id]);

  const isReady = reviewModeReady && (session?.user?.id ? approved !== null : true);

  const effectiveApproved =
    reviewMode || approved === true || isAdmin;

  return {
    approved: effectiveApproved,
    profileApproved: approved,
    isAdmin,
    reviewMode,
    isReady,
  };
}
