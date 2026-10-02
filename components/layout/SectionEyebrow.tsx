export function SectionEyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-caption font-semibold text-muted${className}`}
    >
      {children}
    </div>
  );
}
