"use client";

import { createContext, useContext } from "react";

type TransitionNavValue = {
  /** Internal navigation with the same branded overlay as `<Link>` clicks. */
  navigateWithTransition: (href: string) => void;
};

export const TransitionNavContext = createContext<TransitionNavValue | null>(
  null
);

export function useTransitionNav() {
  return useContext(TransitionNavContext);
}
