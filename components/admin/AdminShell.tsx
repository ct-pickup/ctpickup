"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Workflow-first sections — URLs stay stable where pages already existed. */
const SECTIONS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/publish", label: "Publish" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/tournament", label: "Tournaments" },
  { href: "/admin/esports", label: "Esports" },
  { href: "/admin/pickup", label: "Pickups", activeMatch: "exact" as const },
  { href: "/admin/pickup/standing", label: "Pickup standing" },
  { href: "/admin/relationships", label: "Relationships" },
  { href: "/admin/photo-reports", label: "Photo reports" },
  { href: "/admin/sync", label: "Sync & status" },
  { href: "/admin/settings", label: "Settings" },
] as const;

const PUBLIC_LINKS = [
  { href: "/pickup", label: "Pickup hub" },
  { href: "/pickup/upcoming-games", label: "Upcoming & join" },
  { href: "/status/pickup", label: "Pickup status" },
  { href: "/tournament", label: "Tournament hub" },
  { href: "/status/tournament", label: "Tournament status" },
  { href: "/", label: "Marketing home" },
] as const;

function NavLink({
  href,
  label,
  pathname,
  activeMatch = "prefix",
}: {
  href: string;
  label: string;
  pathname: string;
  activeMatch?: "exact" | "prefix";
}) {
  const active =
    activeMatch === "exact"
      ? pathname === href
      : pathname === href || (href !== "/admin" && pathname.startsWith(href + "/"));
  const activeCls = active ? "bg-overlay text-ink" : "text-muted hover:bg-overlay hover:text-ink";

  return (
    <Link
      href={href}
      className={`block rounded-button px-3 py-2 text-small transition ${activeCls}`}
    >
      {label}
    </Link>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-canvas text-ink md:flex">
      <aside className="hidden shrink-0 border-b border-line md:flex md:w-56 md:flex-col md:border-b-0 md:border-r md:border-line md:py-8 md:pl-4 md:pr-3">
        <div className="px-3 pb-1 text-caption font-semibold text-muted">
          CT Pickup
        </div>
        <div className="px-3 pb-5 text-caption font-medium text-muted">
          Staff control center
        </div>
        <nav className="flex flex-col gap-1" aria-label="Admin navigation">
          {SECTIONS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              pathname={pathname}
              activeMatch={"activeMatch" in item ? item.activeMatch : "prefix"}
            />
          ))}
        </nav>
        <div className="mt-auto hidden pt-10 md:block">
          <div className="px-3 pb-2 text-caption font-semibold text-muted">
            Public preview
          </div>
          <div className="space-y-0.5">
            {PUBLIC_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="block rounded-button px-3 py-1.5 text-caption text-muted transition hover:bg-overlay-subtle hover:text-ink"
              >
                {l.label} ↗
              </Link>
            ))}
          </div>
        </div>
      </aside>

      <nav
        className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden"
        aria-label="Admin navigation"
      >
        {SECTIONS.map((item) => {
          const match = "activeMatch" in item ? item.activeMatch : "prefix";
          const active =
            match === "exact"
              ? pathname === item.href
              : pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-pill px-3 py-1.5 text-caption font-medium ${ active ? "bg-overlay-strong text-ink" : "bg-overlay-subtle text-muted" }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </div>
    </div>
  );
}
