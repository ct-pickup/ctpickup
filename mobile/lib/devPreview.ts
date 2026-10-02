import { useSyncExternalStore } from "react";

/** Dev-only switch for rendering Home with `dev-fixtures` data. Always false in production. */
let enabled = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return __DEV__ && enabled;
}

export function toggleDevPreview(): void {
  if (!__DEV__) return;
  enabled = !enabled;
  for (const listener of listeners) listener();
}

export function useDevPreview(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
