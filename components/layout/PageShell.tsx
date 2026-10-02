export function PageShell({
  children,
  className = "",
  mainClassName = "",
  maxWidthClass = "max-w-5xl",
}: {
  children: React.ReactNode;
  /** Appended to inner container. */
  className?: string;
  /** Optional override on `<main>`. */
  mainClassName?: string;
  /** Tailwind max-width for inner container. */
  maxWidthClass?: string;
}) {
  return (
    <main
      className={`min-h-screen bg-canvas py-5 text-ink ${mainClassName}`}
    >
      <div className={`mx-auto px-4 sm:px-5 ${maxWidthClass} ${className}`}>
        {children}
      </div>
    </main>
  );
}
