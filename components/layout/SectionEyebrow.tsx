export function SectionEyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-xs font-semibold uppercase tracking-[0.22em] text-white/70 ${className}`}
    >
      {children}
    </div>
  );
}
