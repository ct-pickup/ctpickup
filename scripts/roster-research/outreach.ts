import { csvCell, type Row } from "./core.ts";
import { TARGET_STATES } from "./states.ts";
import { cleanText } from "./hometown.ts";

/**
 * Builds the hand-use outreach list from the collected roster CSVs. Offline and local: it reads files already on disk and writes one
 * more file. It does not search anywhere, look anyone up, collect handles or contact details, or send anything.
 */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "vi", "2nd", "3rd", "4th", "esq"]);
/** Words that start a multi-word last name ("De La Cruz", "Van Dyke"): everything from the first one on is the last name. */
const PARTICLES = new Set(["de", "del", "della", "der", "den", "di", "da", "dos", "du", "la", "van", "von", "st", "san", "santa"]);

const token = (t: string): string => t.toLowerCase().replace(/[.,]/g, "");

export type SplitName = { first: string; last: string; suffix: string };

/**
 * "Jordan De La Cruz Jr." -> first Jordan, last "De La Cruz", suffix Jr. Returns null (and the caller logs it) for a single name or
 * anything ambiguous: it never guesses. Nicknames in quotes or parentheses and single-letter middle initials are dropped.
 */
export function splitName(full: string): SplitName | null {
  let s = cleanText(full)
    .replace(/["“”][^"“”]*["“”]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  // "Smith, John" is last-first: ambiguous with "Smith, Jr.", so only a trailing ", Jr." style suffix is understood.
  if (s.includes(",")) {
    const [head, ...rest] = s.split(",").map((x) => x.trim());
    if (rest.length === 1 && SUFFIXES.has(token(rest[0]!))) s = `${head} ${rest[0]}`;
    else return null;
  }
  let words = s.split(" ").filter(Boolean);
  let suffix = "";
  while (words.length > 1 && SUFFIXES.has(token(words[words.length - 1]!))) suffix = words.pop()! + (suffix ? ` ${suffix}` : "");
  if (words.length < 2) return null;
  // Drop single-letter middle initials ("John A. Smith"), but never the first word or the last.
  words = words.filter((w, i) => i === 0 || i === words.length - 1 || token(w).length > 1);
  if (words.length < 2) return null;
  const p = words.findIndex((w, i) => i >= 1 && PARTICLES.has(token(w)) && i < words.length - 1);
  const lastStart = p >= 1 ? p : words.length - 1;
  const first = words.slice(0, lastStart).join(" ");
  const last = words.slice(lastStart).join(" ");
  if (!first || !last) return null;
  return { first, last, suffix: suffix.replace(/\.$/, "") };
}

const norm = (s: string): string => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export type OutreachRow = { first_name: string; last_name: string; school: string; hometown_city: string; hometown_state: string; season: number; team: string; status: string };
export type Unsplit = { school: string; season: number; team: string; name: string; hometown_city: string; hometown_state: string; reason: string };
export type Built = { rows: OutreachRow[]; unsplit: Unsplit[]; merged: number; keptSeparate: number; perState: Record<string, number>; excludedExisting: number };

export const STATE_ORDER: readonly string[] = TARGET_STATES; // CT, NY, NJ, MA, MD, PA, DC, DE, RI

/**
 * One row per player. Players seen in several seasons are merged ONLY when the full name (suffix included), school, team and
 * hometown (city and state) all match; the merged row keeps the most recent season. Anything less certain stays as separate rows.
 */
export function buildOutreach(input: Row[], opts: { includeDuplicateOfExisting?: boolean } = {}): Built {
  const unsplit: Unsplit[] = [];
  let excludedExisting = 0;
  const people = new Map<string, OutreachRow & { _name: string }>();
  let merged = 0;
  const identities = new Map<string, Set<string>>(); // name+school+team -> distinct hometowns (to count "kept separate")

  for (const r of input) {
    if (r.duplicate_of_existing === "true" && !opts.includeDuplicateOfExisting) {
      excludedExisting++;
      continue;
    }
    const sp = splitName(r.name);
    if (!sp) {
      unsplit.push({ school: r.school, season: r.season, team: r.team, name: r.name, hometown_city: r.hometown_city, hometown_state: r.hometown_state, reason: r.name.includes(",") ? "ambiguous comma" : "single name" });
      continue;
    }
    const fullName = norm(`${sp.first} ${sp.last} ${sp.suffix}`);
    const home = `${norm(r.hometown_city)}|${r.hometown_state}`;
    const id = `${fullName}|${norm(r.school)}|${r.team}`;
    identities.set(id, (identities.get(id) ?? new Set()).add(home));
    const key = `${id}|${home}`;
    const row = { first_name: sp.first, last_name: sp.last, school: r.school, hometown_city: r.hometown_city, hometown_state: r.hometown_state, season: Number(r.season), team: r.team, status: "", _name: fullName };
    const prior = people.get(key);
    if (!prior) people.set(key, row);
    else {
      merged++;
      if (row.season > prior.season) people.set(key, row);
    }
  }
  const keptSeparate = [...identities.values()].filter((h) => h.size > 1).length;

  const rows = sortOutreach([...people.values()].map(({ _name, ...rest }) => (void _name, rest)));
  const perState: Record<string, number> = {};
  for (const r of rows) perState[r.hometown_state] = (perState[r.hometown_state] ?? 0) + 1;
  return { rows, unsplit, merged, keptSeparate, perState, excludedExisting };
}

/** State priority (CT, NY, NJ, MA, MD, PA, DC, DE, RI), then newest season first, then school, then last name, then first name. */
export function sortOutreach(rows: OutreachRow[]): OutreachRow[] {
  const rank = (s: string) => {
    const i = STATE_ORDER.indexOf(s);
    return i < 0 ? STATE_ORDER.length : i;
  };
  return [...rows].sort(
    (a, b) =>
      rank(a.hometown_state) - rank(b.hometown_state) ||
      b.season - a.season ||
      a.school.localeCompare(b.school) ||
      a.last_name.localeCompare(b.last_name) ||
      a.first_name.localeCompare(b.first_name) ||
      a.hometown_city.localeCompare(b.hometown_city),
  );
}

export const OUTREACH_COLUMNS = ["first_name", "last_name", "school", "hometown_city", "hometown_state", "season", "team", "status"] as const;
export const UNSPLIT_COLUMNS = ["school", "season", "team", "name", "hometown_city", "hometown_state", "reason"] as const;

export function outreachCsv(rows: OutreachRow[]): string {
  return [OUTREACH_COLUMNS.join(","), ...rows.map((r) => OUTREACH_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}
export function unsplitCsv(rows: Unsplit[]): string {
  return [UNSPLIT_COLUMNS.join(","), ...rows.map((r) => UNSPLIT_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export function outreachSummary(b: Built): string[] {
  const lines = [`Outreach list: ${b.rows.length} rows`];
  for (const s of STATE_ORDER) lines.push(`  ${s}: ${b.perState[s] ?? 0}`);
  const other = Object.keys(b.perState).filter((s) => !STATE_ORDER.includes(s));
  for (const s of other) lines.push(`  ${s}: ${b.perState[s]}`);
  lines.push(`Duplicates merged (same name, school, team and hometown in more than one season): ${b.merged}`);
  lines.push(`Kept as separate rows because the hometown differs (could be two people): ${b.keptSeparate}`);
  lines.push(`Names that could not be split (not in the list, see outreach_unsplit.csv): ${b.unsplit.length}`);
  if (b.excludedExisting) lines.push(`Left out because they are flagged duplicate_of_existing (use --include-duplicate-of-existing to add them): ${b.excludedExisting}`);
  return lines;
}
