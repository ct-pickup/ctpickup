import Link from "next/link";

/** Legacy compact nav — prefer sidebar in `AdminShell`. Kept for narrow contexts. */
const ADMIN_LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/tournament", label: "Tournaments" },
  { href: "/admin/pickup", label: "Pickups" },
  { href: "/admin/pickup/standing", label: "Pickup standing" },
  { href: "/admin/relationships", label: "Relationships" },
  { href: "/admin/sync", label: "Sync" },
  { href: "/admin/settings", label: "Settings" },
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
