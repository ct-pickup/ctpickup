import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/** True while this screen is the focused one and the app is in the foreground. Use it to start and stop polling. */
export function useScreenActive(): boolean {
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  return focused && appActive;
}
