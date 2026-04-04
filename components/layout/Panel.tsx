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
      className={`rounded-2xl border border-white/15 bg-white/5 p-5 md:p-6 ${className}`}
    >
      {children}
    </div>
  );
}
