/** Consistent empty-state copy (no data) — premium red on dark UI. */
export function EmptyStateMessage({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`text-small font-medium text-coral-text ${className}`.trim()}
    >
      {children}
    </p>
  );
}
