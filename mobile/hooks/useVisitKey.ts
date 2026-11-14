import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

/** Counts up each time the screen gains focus. Pass it as a dependency so a reveal (count-up, bar fill) plays once per visit. */
export function useVisitKey(): number {
  const [key, setKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setKey((k) => k + 1);
    }, []),
  );
  return key;
}
