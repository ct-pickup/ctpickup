import type { ReactNode } from "react";

/**
 * Every admin view states what it is for (operational question) before the tools.
 */
export function AdminWorkArea({
  question,
  children,
  className = "",
}: {
  /** The one thing this screen helps staff answer right away */
  question: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-white/60">{question}</p>
      {children}
    </div>
  );
}
