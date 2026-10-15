import { parseRosterHtml } from "./sidearm.ts";
import type { Getter } from "./core.ts";

/** Which website platform an athletics site runs on, and whether its roster pages can be reached and read. Pure apart from the fetcher. */

export type Platform = "sidearm" | "prestosports" | "wmt" | "athleticsdotcom" | "unknown";

const SIGNATURES: { platform: Platform; tests: RegExp[] }[] = [
  { platform: "sidearm", tests: [/sidearmsports\.com/i, /\bsidearm[-_ ]?(?:sports|stats)?\b/i, /data-sidearm/i, /class="[^"]*\bsidearm-/i, /\/sports\/[a-z-]+\/roster/i] },
  { platform: "prestosports", tests: [/prestosports\.com/i, /\bpresto\s?sports\b/i, /\/sports\/(?:msoc|wsoc|mbkb|wbkb|bsb|sball)\//i, /data-presto/i] },
  { platform: "wmt", tests: [/wmt\.games/i, /wmtdigital/i, /\bwmt[-_ ]games\b/i, /images\.wmt/i] },
  { platform: "athleticsdotcom", tests: [/athletics\.com/i, /\bathletics websites\b/i] },
];

/** Looks at a home page's HTML. Sidearm wins ties because its markers are the most specific. */
export function detectPlatform(html: string): { platform: Platform; evidence: string } {
  for (const sig of SIGNATURES) {
    const hit = sig.tests.find((t) => t.test(html));
    if (hit) return { platform: sig.platform, evidence: hit.source };
  }
  return { platform: "unknown", evidence: "" };
}

export type RosterStatus = "unchecked" | "verified" | "needs_review" | "unsupported_platform";
export type ProgramCheck = "found" | "not_found" | "blocked_by_robots" | "error" | "unparsed" | "no_program";
export type RosterInfo = {
  status: RosterStatus;
  reason: string;
  /** The season used for the check, and the program-by-program result. */
  season?: number;
  men?: ProgramCheck;
  women?: ProgramCheck;
  /** For platforms whose pattern is simple but whose pages the collector cannot read yet. */
  pattern?: string;
  checked_at?: string;
};

export const sidearmRosterUrl = (base: string, team: "men" | "women", season: number): string =>
  `${base.replace(/\/+$/, "")}/sports/${team === "men" ? "mens" : "womens"}-soccer/roster/${season}`;

export const prestoRosterPattern = (base: string): string => `${base.replace(/\/+$/, "")}/sports/{msoc|wsoc}/{season}-{yy}/roster`;

export type PlatformSchool = { base: string; men?: boolean; women?: boolean; platform?: Platform };

/** Fetches the home page and says which platform it is. Never guesses: an unreachable home page is reported as such. */
export async function detectSchoolPlatform(school: PlatformSchool, fetcher: Getter): Promise<{ platform: Platform; problem: string }> {
  if (!school.base) return { platform: "unknown", problem: "no athletics website address (add it in schools/overrides.json)" };
  const res = await fetcher.get(`${school.base.replace(/\/+$/, "")}/`);
  if (res.blockedByRobots) return { platform: "unknown", problem: "home page blocked by robots.txt" };
  if (res.error || res.status === 0 || res.status >= 500) return { platform: "unknown", problem: `home page unreachable (${res.error ?? `HTTP ${res.status}`})` };
  if (res.status !== 200) return { platform: "unknown", problem: `home page answered HTTP ${res.status}` };
  return { platform: detectPlatform(res.body).platform, problem: "" };
}

async function checkProgram(base: string, team: "men" | "women", season: number, fetcher: Getter): Promise<ProgramCheck> {
  const res = await fetcher.get(sidearmRosterUrl(base, team, season));
  if (res.blockedByRobots) return "blocked_by_robots";
  if (res.error || res.status === 0 || res.status >= 500 || res.status === 429) return "error";
  if (res.status !== 200) return "not_found";
  return parseRosterHtml(res.body).players.length > 0 ? "found" : "unparsed";
}

const REASON: Record<ProgramCheck, string> = {
  found: "",
  not_found: "roster page not found",
  blocked_by_robots: "blocked by robots.txt",
  error: "network error: run again",
  unparsed: "page found but the roster layout was not recognised",
  no_program: "",
};

/**
 * One request per program. A Sidearm school is verified only if every program it has answers with a roster page the parser can read.
 * Other platforms are kept in the list as unsupported_platform (with the roster pattern when it is simple). A URL that fails is never
 * "fixed" by guessing another: the school is marked needs_review with the reason.
 */
export async function verifyRoster(school: PlatformSchool & { platform: Platform }, fetcher: Getter, season: number, nowIso: string): Promise<RosterInfo> {
  const base: RosterInfo = { status: "unchecked", reason: "", season, checked_at: nowIso };
  if (school.platform === "prestosports") return { ...base, status: "unsupported_platform", reason: "PrestoSports roster pages are not read yet", pattern: prestoRosterPattern(school.base) };
  if (school.platform !== "sidearm") {
    return { ...base, status: "unsupported_platform", reason: school.platform === "unknown" ? "platform not recognised" : `${school.platform} roster pages are not read yet` };
  }
  const wantsMen = school.men !== false;
  const wantsWomen = school.women !== false;
  const men = wantsMen ? await checkProgram(school.base, "men", season, fetcher) : "no_program";
  const women = wantsWomen ? await checkProgram(school.base, "women", season, fetcher) : "no_program";
  const bad = ([["men's", men], ["women's", women]] as const).filter(([, c]) => c !== "found" && c !== "no_program");
  if (bad.length === 0) return { ...base, status: "verified", men, women };
  return { ...base, status: "needs_review", men, women, reason: bad.map(([t, c]) => `${t} ${REASON[c]}`).join("; ") };
}
