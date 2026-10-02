export function Panel({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`rounded-card border border-line bg-overlay-subtle p-5 md:p-6${className}`}
    >
      {children}
    </div>
  );
}
