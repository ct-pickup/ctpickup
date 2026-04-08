import { trainingCoaches } from "@/lib/trainingCoaches";

export type HelpNavAction = {
  label: string;
  href: string;
  reason?: string;
};

type RouteDef = {
  href: string;
  label: string;
  /** Omit from model prompt; only valid when user is admin. */
  adminOnly?: boolean;
};

const COACH_SLUGS = new Set(trainingCoaches.map((c) => c.slug));

/** Canonical internal destinations the assistant may suggest (server + client sanitize to this set). */
export const HELP_NAV_ROUTES: RouteDef[] = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/login", label: "Log in" },
  { href: "/signup", label: "Sign up" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/profile", label: "Profile" },
  { href: "/pickup", label: "Pickup" },
  { href: "/pickup/how-it-works", label: "How pickup works" },
  { href: "/pickup/intake", label: "Pickup intake" },
  { href: "/pickup/join-a-game", label: "Join a game" },
  { href: "/pickup/upcoming-games", label: "Upcoming games" },
  { href: "/tournament", label: "Tournaments" },
  { href: "/tournament/how-it-works", label: "Tournament info" },
  { href: "/training", label: "Training" },
  { href: "/u23", label: "U23" },
  { href: "/esports", label: "Esports" },
  { href: "/esports/tournaments", label: "Esports tournaments" },
  { href: "/community", label: "Community" },
  { href: "/mission", label: "Mission" },
  { href: "/guidance", label: "Guidance" },
  { href: "/info", label: "Info" },
  { href: "/rules", label: "Rules" },
  { href: "/liability-waiver", label: "Liability waiver" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/help", label: "Help" },
  { href: "/update", label: "Request an update" },
  { href: "/status", label: "Status" },
  { href: "/status/pickup", label: "Pickup status" },
  { href: "/status/tournament", label: "Tournament status" },
  { href: "/dm", label: "DM" },
  { href: "/admin", label: "Admin · Overview", adminOnly: true },
  { href: "/admin/publish", label: "Admin · Publish", adminOnly: true },
  { href: "/admin/pickup", label: "Admin · Pickup", adminOnly: true },
  { href: "/admin/tournament", label: "Admin · Tournament", adminOnly: true },
  { href: "/admin/status", label: "Admin · Status", adminOnly: true },
  { href: "/admin/esports", label: "Admin · Esports", adminOnly: true },
];

const HREF_TO_LABEL = new Map(
  HELP_NAV_ROUTES.filter((r) => !r.adminOnly).map((r) => [r.href, r.label])
);

for (const r of HELP_NAV_ROUTES) {
  if (r.adminOnly) HREF_TO_LABEL.set(r.href, r.label);
}

function normalizePath(href: string): string {
  const t = String(href || "").trim();
  if (!t.startsWith("/")) return "";
  const pathOnly = t.split("?")[0].split("#")[0];
  const noTrail = pathOnly.replace(/\/+$/, "") || "/";
  return noTrail;
}

function isAllowedCoachPath(pathname: string): boolean {
  const m = pathname.match(/^\/training\/coaches\/([a-z0-9-]+)$/);
  if (!m) return false;
  return COACH_SLUGS.has(m[1]);
}

function labelForHref(pathname: string): string {
  if (HREF_TO_LABEL.has(pathname)) return HREF_TO_LABEL.get(pathname)!;
  const m = pathname.match(/^\/training\/coaches\/([a-z0-9-]+)$/);
  if (m && COACH_SLUGS.has(m[1])) {
    const coach = trainingCoaches.find((c) => c.slug === m[1]);
    return coach ? `${coach.name} · Training` : "Coach page";
  }
  return "Open";
}

/**
 * Markdown block for the system prompt: paths the model may put in NAV_ACTIONS_JSON.
 */
export function helpNavRoutesForPrompt(): string {
  const publicLines = HELP_NAV_ROUTES.filter((r) => !r.adminOnly).map(
    (r) => `- ${r.href} — ${r.label}`
  );
  const coachLines = trainingCoaches.map(
    (c) => `- /training/coaches/${c.slug} — ${c.name} (training)`
  );
  return [...publicLines, ...coachLines].join("\n");
}

const NAV_MARKERS = ["\nNAV_ACTIONS_JSON:", "NAV_ACTIONS_JSON:"] as const;

/**
 * Strip trailing NAV line and parse actions from model output.
 */
export function stripNavActionsFromModelText(raw: string): {
  userText: string;
  rawActions: unknown[];
} {
  const text = String(raw ?? "");
  let idx = -1;
  let markerLen = 0;
  for (const m of NAV_MARKERS) {
    const j = text.lastIndexOf(m);
    if (j !== -1 && j >= idx) {
      idx = j;
      markerLen = m.length;
    }
  }
  if (idx === -1) {
    return { userText: text.trimEnd(), rawActions: [] };
  }

  const userText = text.slice(0, idx).trimEnd();
  const jsonStr = text.slice(idx + markerLen).trim();
  if (!jsonStr) return { userText, rawActions: [] };

  try {
    const parsed = JSON.parse(jsonStr) as { actions?: unknown };
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    return { userText, rawActions: actions };
  } catch {
    return { userText, rawActions: [] };
  }
}

/**
 * Keep only safe internal paths; cap count; dedupe; normalize labels.
 */
export function sanitizeHelpNavActions(
  rawActions: unknown[],
  options: { isAdmin: boolean; maxActions?: number }
): HelpNavAction[] {
  const max = Math.min(4, Math.max(1, options.maxActions ?? 3));

  const out: HelpNavAction[] = [];
  const seen = new Set<string>();

  for (const item of rawActions) {
    if (out.length >= max) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const hrefRaw = typeof o.href === "string" ? o.href : "";
    const pathname = normalizePath(hrefRaw);
    if (!pathname) continue;

    const def = HELP_NAV_ROUTES.find((r) => r.href === pathname);
    const coachOk = isAllowedCoachPath(pathname);
    if (!def && !coachOk) continue;
    if (def?.adminOnly && !options.isAdmin) continue;

    if (seen.has(pathname)) continue;
    seen.add(pathname);

    const labelIn =
      typeof o.label === "string" && o.label.trim() ? o.label.trim() : "";
    const label = labelIn || labelForHref(pathname);
    const reason =
      typeof o.reason === "string" && o.reason.trim()
        ? o.reason.trim()
        : undefined;

    out.push({
      href: pathname === "/" ? "/" : pathname,
      label: label.slice(0, 80),
      reason: reason?.slice(0, 200),
    });
  }

  return out;
}

/** Client-side safety net: only render buttons for paths still allowed. */
export function filterNavActionsForClient(
  actions: unknown,
  options: { isAdmin: boolean }
): HelpNavAction[] {
  if (!Array.isArray(actions)) return [];
  return sanitizeHelpNavActions(actions, {
    isAdmin: options.isAdmin,
    maxActions: 4,
  });
}
