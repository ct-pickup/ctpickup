import { AccessibilityInfo } from "react-native";
import { useEffect, useState } from "react";

/**
 * iOS / Android “Reduce motion”; when true skip decorative springs and loops.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((enabled) => {
      if (!cancelled) setReduceMotion(Boolean(enabled));
    });
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}
