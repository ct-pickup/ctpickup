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
  { href: "/admin/pickup", label: "Pickups", activeMatch: "exact" as const },
  { href: "/admin/pickup/standing", label: "Pickup standing" },
  { href: "/admin/relationships", label: "Relationships" },
  { href: "/admin/sync", label: "Sync & status" },
  { href: "/admin/settings", label: "Settings" },
] as const;

const PUBLIC_LINKS = [
  { href: "/pickup", label: "Pickup hub" },
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
  const activeCls = active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white";

  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-sm transition ${activeCls}`}
    >
      {label}
    </Link>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-black text-white md:flex">
      <aside className="hidden shrink-0 border-b border-white/10 md:flex md:w-56 md:flex-col md:border-b-0 md:border-r md:border-white/10 md:py-8 md:pl-4 md:pr-3">
        <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-widest text-white/45">
          CT Pickup
        </div>
        <div className="px-3 pb-5 text-[11px] font-medium uppercase tracking-wider text-white/35">
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
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">
            Public preview
          </div>
          <div className="space-y-0.5">
            {PUBLIC_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg px-3 py-1.5 text-xs text-white/50 transition hover:bg-white/[0.04] hover:text-white/80"
              >
                {l.label} ↗
              </Link>
            ))}
          </div>
        </div>
      </aside>

      <nav
        className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 md:hidden"
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
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                active ? "bg-white/15 text-white" : "bg-white/[0.06] text-white/70"
              }`}
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
