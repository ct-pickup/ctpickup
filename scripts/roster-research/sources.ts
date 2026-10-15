import { cleanText } from "./hometown.ts";
import { normalizeState } from "./states.ts";

/**
 * Parsers for the places a list of college soccer programs can come from. Pure: they take text and return schools, and never invent
 * one. The shapes of the live sources could not be checked from the build environment, so every parser is defensive and the
 * builder reports how many schools each source gave; a source that gives none is skipped and the next one in line is used.
 */

export type ParsedSchool = { name: string; state: string; conference: string; base: string; ncaaId?: string };

/** "https://www.example.edu/athletics/home" -> "https://www.example.edu". Null for anything that is not a web address. */
export function siteOrigin(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let t = raw.trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if (!u.hostname.includes(".")) return "";
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return "";
  }
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const str = (v: unknown): string => (typeof v === "string" ? cleanText(v) : typeof v === "number" ? String(v) : "");

/** The NCAA directory API: an array of members (or an object holding one). Field names vary, so several are tried. */
export function parseNcaaDirectory(json: unknown): ParsedSchool[] {
  const list: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? ((Object.values(json as Record<string, unknown>).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [])
      : [];
  const out: ParsedSchool[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const name = str(pick(o, ["nameOfficial", "name", "orgName", "institutionName", "schoolName", "nameShort"]));
    if (!name) continue;
    const addr = (pick(o, ["memberOrgAddress", "address", "orgAddress"]) ?? {}) as Record<string, unknown>;
    const stateRaw = str(pick(addr, ["state", "stateCode", "stateAbbr"]) ?? pick(o, ["state", "stateCode"]));
    const conf = pick(o, ["conferenceName", "conference", "primaryConference", "conferenceNameShort"]);
    const confName = typeof conf === "object" && conf ? str(pick(conf as Record<string, unknown>, ["name", "conferenceName"])) : str(conf);
    out.push({
      name,
      state: normalizeState(stateRaw) ?? "",
      conference: confName,
      base: siteOrigin(pick(o, ["athleticWebUrl", "athleticsUrl", "athleticsWebsite", "athleticWebsite", "webSiteUrl", "website", "url"])),
      ncaaId: str(pick(o, ["orgId", "id", "memberOrgId"])) || undefined,
    });
  }
  return out;
}

const stripTags = (s: string): string => cleanText(s.replace(/<sup[\s\S]*?<\/sup>/gi, "").replace(/\[[^\]]*\]/g, ""));

/** The header cell text -> which column it is. */
function columnKind(h: string): "name" | "state" | "conference" | "location" | null {
  const t = h.toLowerCase();
  if (/^(institution|school|team|university|college|member|program)/.test(t)) return "name";
  if (/^state/.test(t)) return "state";
  if (/conference|region|league/.test(t)) return "conference";
  if (/location|city|home/.test(t)) return "location";
  return null;
}

/** Any HTML table (a Wikipedia wikitable, an NJCAA member table) with a school column; state and conference columns when present. */
export function parseSchoolTables(html: string): ParsedSchool[] {
  const out: ParsedSchool[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    let cols: Record<string, number> | null = null;
    for (const r of rows) {
      const cells = [...r.matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => ({ tag: m[1]!.toLowerCase(), html: m[2]!, text: stripTags(m[2]!) }));
      if (cells.length === 0) continue;
      if (!cols && cells.every((c) => c.tag === "h")) {
        const found: Record<string, number> = {};
        cells.forEach((c, i) => {
          const k = columnKind(c.text);
          if (k && found[k] === undefined) found[k] = i;
        });
        if (found.name !== undefined) cols = found;
        continue;
      }
      if (!cols) continue;
      const name = cells[cols.name!]?.text ?? "";
      if (!name || name.length > 120) continue;
      let state = cols.state !== undefined ? normalizeState(cells[cols.state]?.text) : null;
      if (!state && cols.location !== undefined) {
        const loc = cells[cols.location]?.text ?? "";
        state = normalizeState(loc.split(",").pop());
      }
      const href = /href="(https?:\/\/[^"]+)"/i.exec(cells[cols.name!]?.html ?? "")?.[1];
      out.push({ name: name.replace(/[†‡*]+$/g, "").trim(), state: state ?? "", conference: cols.conference !== undefined ? (cells[cols.conference]?.text ?? "") : "", base: href && !/wikipedia\.org/.test(href) ? siteOrigin(href) : "" });
    }
  }
  return out;
}
