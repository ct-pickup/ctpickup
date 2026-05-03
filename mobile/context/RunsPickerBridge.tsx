import React, { createContext, useCallback, useContext, useRef } from "react";

type Ctx = {
  registerReset: (fn: (() => void) | null) => void;
  resetToStatePicker: () => void;
};

const RunsPickerBridgeContext = createContext<Ctx | null>(null);

export function RunsPickerBridgeProvider({ children }: { children: React.ReactNode }) {
  const cb = useRef<(() => void) | null>(null);

  const registerReset = useCallback((fn: (() => void) | null) => {
    cb.current = fn;
  }, []);

  const resetToStatePicker = useCallback(() => {
    cb.current?.();
  }, []);

  const value = React.useMemo(
    () => ({ registerReset, resetToStatePicker }),
    [registerReset, resetToStatePicker],
  );

  return <RunsPickerBridgeContext.Provider value={value}>{children}</RunsPickerBridgeContext.Provider>;
}

export function useRunsPickerBridge(): Ctx {
  const ctx = useContext(RunsPickerBridgeContext);
  if (!ctx) {
    throw new Error("useRunsPickerBridge must be used within RunsPickerBridgeProvider");
  }
  return ctx;
}
