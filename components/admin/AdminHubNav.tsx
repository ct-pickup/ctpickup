import Link from "next/link";

const ADMIN_LINKS = [
  { href: "/admin/pickup", label: "Pickup" },
  { href: "/admin/tournament", label: "Tournament" },
  { href: "/admin/guidance", label: "Guidance" },
  { href: "/admin/esports", label: "Esports" },
  { href: "/admin/waivers", label: "Waivers" },
  { href: "/admin/status", label: "Status" },
] as const;

export function AdminHubNav({
  className = "",
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  const navTone = tone === "dark" ? "text-white/50" : "text-gray-600";
  const linkTone =
    tone === "dark"
      ? "underline-offset-4 transition hover:text-white hover:underline"
      : "underline-offset-4 transition hover:text-gray-900 hover:underline";

  return (
    <nav
      className={`flex flex-wrap gap-x-4 gap-y-2 text-sm ${navTone} ${className}`}
      aria-label="Admin sections"
    >
      {ADMIN_LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={linkTone}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
