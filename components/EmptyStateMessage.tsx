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
      className={`text-sm font-medium text-red-300/95 ${className}`.trim()}
    >
      {children}
    </p>
  );
}
