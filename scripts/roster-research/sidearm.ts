import { cleanText, normalizeClass, parseHometown, type Hometown } from "./hometown.ts";

/**
 * Parses an official athletics roster page (Sidearm Sports markup, three layouts seen in the wild) into plain rows. No DOM library:
 * the pages are split into player blocks and the few fields we keep are pulled out. It keeps ONLY: name, class, position,
 * hometown city and state. The high school, height, weight, photo and links are read past and dropped.
 *
 *   list   <li class="sidearm-roster-player ..."> with sidearm-roster-player-name / -position / -academic-year / -hometown
 *   table  <table class="sidearm-table"> with a header row (Name, Pos., Cl., Hometown/High School)
 *   card   <li class="s-person-card ..."> with s-person-details__* label / value pairs
 */

export type RosterPlayer = { name: string; classYear: string; position: string; hometownRaw: string; hometown: Hometown };
export type ParseResult = { format: "list" | "table" | "card" | "none"; players: RosterPlayer[]; failures: string[] };

const first = (re: RegExp, s: string): string => {
  const m = re.exec(s);
  return m ? cleanText(m[1] ?? "") : "";
};

function finish(name: string, cls: string, pos: string, home: string): RosterPlayer | null {
  const nm = cleanText(name).replace(/^\d+\s+/, "").replace(/\s+/g, " ").trim();
  if (!nm) return null;
  return { name: nm, classYear: normalizeClass(cls), position: cleanText(pos).replace(/\.$/, ""), hometownRaw: cleanText(home).split(/\s\/\s|\/(?=\s*[A-Z])/)[0]!.trim(), hometown: parseHometown(home) };
}

function parseList(html: string): ParseResult {
  const blocks = html.split(/<li[^>]*class="[^"]*\bsidearm-roster-player\b[^"]*"[^>]*>/i).slice(1);
  const players: RosterPlayer[] = [];
  const failures: string[] = [];
  for (const b of blocks) {
    const name = first(/sidearm-roster-player-name[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i, b) || first(/sidearm-roster-player-name[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i, b);
    const pos = first(/sidearm-roster-player-position[\s\S]*?<span[^>]*class="[^"]*text-bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i, b) || first(/sidearm-roster-player-position[^>]*>([\s\S]*?)<\/(?:div|span)>/i, b);
    const cls = first(/sidearm-roster-player-(?:academic-year|class)[^>]*>([\s\S]*?)<\/span>/i, b);
    const home = first(/sidearm-roster-player-hometown[^>]*>([\s\S]*?)<\/span>/i, b);
    const p = finish(name, cls, pos, home);
    if (p) players.push(p);
    else failures.push(`list block without a name: ${cleanText(b).slice(0, 80)}`);
  }
  return { format: "list", players, failures };
}

const HEADER_KEYS: [string, RegExp][] = [
  ["name", /^(name|full name|player)$/],
  ["pos", /^(pos|position|pos\.)$/],
  ["cls", /^(cl|class|yr|year|academic year|eligibility|cl\.)$/],
  ["home", /^(hometown(\/.*)?|home town|hometown \/ high school|hometown\/last school|hometown\/previous school)$/],
];

function parseTable(html: string): ParseResult {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const players: RosterPlayer[] = [];
  const failures: string[] = [];
  for (const t of tables) {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    let idx: Record<string, number> | null = null;
    for (const r of rows) {
      const headCells = [...r.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => cleanText(m[1]!).toLowerCase());
      const cells = [...r.matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => ({ tag: m[1]!, text: cleanText(m[2]!), raw: m[2]! }));
      if (!idx && headCells.length >= 3 && cells.every((c) => c.tag === "h")) {
        const found: Record<string, number> = {};
        headCells.forEach((h, i) => {
          for (const [key, re] of HEADER_KEYS) if (re.test(h) && found[key] === undefined) found[key] = i;
        });
        if (found.name !== undefined && found.home !== undefined) idx = found;
        continue;
      }
      if (!idx) continue;
      if (cells.length < 3) continue;
      const p = finish(cells[idx.name!]?.text ?? "", cells[idx.cls ?? -1]?.text ?? "", cells[idx.pos ?? -1]?.text ?? "", cells[idx.home!]?.text ?? "");
      if (p) players.push(p);
      else failures.push(`table row without a name: ${cells.map((c) => c.text).join(" | ").slice(0, 80)}`);
    }
    if (players.length) break;
  }
  return { format: "table", players, failures };
}

function parseCards(html: string): ParseResult {
  const blocks = html.split(/<li[^>]*class="[^"]*\bs-person-card\b[^"]*"[^>]*>/i).slice(1);
  const players: RosterPlayer[] = [];
  const failures: string[] = [];
  for (const b of blocks) {
    const name = first(/s-person-details__personal-single-item--name[^>]*>([\s\S]*?)<\/(?:a|span|div|h3)>/i, b) || first(/s-person-card__header__person-details-name[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i, b) || first(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i, b);
    const pair = (label: RegExp): string => {
      const m = new RegExp(`s-person-details__bio-stats-label[^>]*>\\s*(?:${label.source})\\s*:?\\s*<\\/[^>]+>\\s*<[^>]*class="[^"]*s-person-details__bio-stats-value[^"]*"[^>]*>([\\s\\S]*?)<\\/`, "i").exec(b);
      return m ? cleanText(m[1]!) : "";
    };
    const pos = pair(/position|pos\.?/) || first(/s-person-details__position[^>]*>([\s\S]*?)<\/(?:span|div)>/i, b);
    const cls = pair(/class|academic year|year|cl\.?/);
    const home = pair(/hometown(?:\s*\/\s*high school)?/);
    const p = finish(name, cls, pos, home);
    if (p) players.push(p);
    else failures.push(`card without a name: ${cleanText(b).slice(0, 80)}`);
  }
  return { format: "card", players, failures };
}

/** Tries the layouts in turn and keeps the one that found players. */
export function parseRosterHtml(html: string): ParseResult {
  for (const f of [parseList, parseTable, parseCards]) {
    const r = f(html);
    if (r.players.length > 0) return r;
  }
  return { format: "none", players: [], failures: ["no roster layout recognised"] };
}

/** How odd a row looks, for the "messiest rows" list: higher is messier. */
export function messiness(p: RosterPlayer): number {
  let score = 0;
  if (p.hometown.messy) score += 2;
  if (p.hometown.kind === "unreadable") score += 3;
  if (!p.classYear) score += 1;
  if (!p.position) score += 1;
  if (p.name.length > 40 || /\d/.test(p.name)) score += 2;
  if (/[<>{}]/.test(p.hometownRaw + p.name)) score += 3;
  return score;
}
