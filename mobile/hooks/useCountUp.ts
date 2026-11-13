import { useEffect, useRef, useState } from "react";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { countUpDurationMs, countUpValue } from "@/lib/motionCore";

/**
 * Counts from 0 up to `target` once, when `target` first becomes a number (and again if it changes). Returns the current value and
 * whether it has landed. With Reduce Motion the value is the target at once. `onLanded` fires once per run, after the last frame.
 */
/** `runKey` restarts the count-up when it changes (one run per screen visit). */
export function useCountUp(target: number | null | undefined, onLanded?: () => void, runKey: number = 0): { value: number | null; landed: boolean } {
  const reduceMotion = useReduceMotion();
  const [value, setValue] = useState<number | null>(null);
  const [landed, setLanded] = useState(false);
  const landedRef = useRef(onLanded);
  useEffect(() => {
    landedRef.current = onLanded;
  });

  useEffect(() => {
    if (typeof target !== "number" || !Number.isFinite(target)) {
      setValue(null);
      setLanded(false);
      return;
    }
    if (reduceMotion) {
      setValue(target);
      setLanded(true);
      return;
    }
    let frame = 0;
    let cancelled = false;
    const duration = countUpDurationMs(target);
    const start = Date.now();
    setLanded(false);
    const tick = () => {
      if (cancelled) return;
      const t = (Date.now() - start) / duration;
      if (t >= 1) {
        setValue(target);
        setLanded(true);
        landedRef.current?.();
        return;
      }
      setValue(countUpValue(t, target));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target, reduceMotion, runKey]);

  return { value, landed };
}
