import { Suspense } from "react";
import { PageTransition } from "@/components/PageTransition";

/**
 * Server `Suspense` so `useSearchParams()` inside `PageTransition` satisfies
 * static generation (CSR bailout) for every route segment.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<>{children}</>}>
      <PageTransition>{children}</PageTransition>
    </Suspense>
  );
}
