import { createContext, useContext } from "react";

type ReplayOpeningThemeContextValue = {
  replayOpeningTheme: () => Promise<void>;
};

export const ReplayOpeningThemeContext = createContext<ReplayOpeningThemeContextValue | undefined>(undefined);

export function useReplayOpeningTheme(): ReplayOpeningThemeContextValue | undefined {
  return useContext(ReplayOpeningThemeContext);
}
