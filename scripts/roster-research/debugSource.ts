import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeDivision, parseNcaaDirectory } from "./sources.ts";

/**
 * Offline diagnostic for the NCAA directory: reads only responses already in the on-disk cache and describes their shape. It prints
 * field names, the distinct values of every division-like and sport-like field with counts, how many distinct schools there are, and
 * five sample records with only the school name, division, conference, state and sport. No player data exists in these responses.
 */

type Obj = Record<string, unknown>;

/** Every path in a record down to `depth` levels, with the value's type: "memberOrgAddress.state (string)". */
export function fieldPaths(o: unknown, prefix = "", depth = 2): string[] {
  if (!o || typeof o !== "object") return [];
  if (Array.isArray(o)) return [`${prefix} (array of ${o.length ? (typeof o[0] === "object" ? "object" : typeof o[0]) : "nothing"})`, ...(depth > 0 && o[0] && typeof o[0] === "object" ? fieldPaths(o[0], `${prefix}[]`, depth - 1) : [])];
  return Object.entries(o as Obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? (Array.isArray(v) || depth > 0 ? fieldPaths(v, path, depth - 1) : [`${path} (object)`]) : [`${path} (${v === null ? "null" : typeof v})`];
  });
}

/** Every string/number leaf under keys whose name matches `keyRe`, as "path=value" pairs. */
function valuesUnder(o: unknown, keyRe: RegExp, prefix = "", inside = false): { path: string; value: string | number | boolean }[] {
  if (o === null || o === undefined) return [];
  if (typeof o !== "object") return inside ? [{ path: prefix, value: o as string | number | boolean }] : [];
  if (Array.isArray(o)) return o.flatMap((x) => valuesUnder(x, keyRe, prefix, inside));
  return Object.entries(o as Obj).flatMap(([k, v]) => valuesUnder(v, keyRe, prefix ? `${prefix}.${k}` : k, inside || keyRe.test(k)));
}

const tally = (items: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export function recordsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") return (Object.values(json as Obj).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [];
  return [];
}

export function describeNcaa(json: unknown, url = ""): string[] {
  const records = recordsOf(json);
  const lines: string[] = [`--- ${url || "response"}: ${records.length} records ---`];
  if (records.length === 0) {
    lines.push("  not a list of records. Top-level keys: " + (json && typeof json === "object" ? Object.keys(json as Obj).join(", ") || "(none)" : typeof json));
    return lines;
  }
  lines.push("Field names of one record (path (type)):");
  for (const f of fieldPaths(records[0])) lines.push(`  ${f}`);

  const divs = records.flatMap((r) => valuesUnder(r, /divis/i));
  lines.push("", "Division-like fields: distinct values with counts (each shown as path = value):");
  if (divs.length === 0) lines.push("  (no field with 'divis' in its name)");
  for (const [k, n] of tally(divs.map((d) => `${d.path} = ${JSON.stringify(d.value)}`)).slice(0, 40)) lines.push(`  ${String(n).padStart(5)}  ${k}`);

  const sports = records.flatMap((r) => valuesUnder(r, /sport/i));
  lines.push("", "Sport-like fields: distinct values with counts:");
  if (sports.length === 0) lines.push("  (no field with 'sport' in its name)");
  for (const [k, n] of tally(sports.map((d) => `${d.path} = ${JSON.stringify(d.value)}`)).slice(0, 40)) lines.push(`  ${String(n).padStart(5)}  ${k}`);

  const flagValues = (key: string) => tally(records.map((r) => (r && typeof r === "object" && key in (r as Obj) ? JSON.stringify((r as Obj)[key]) : "(field missing)")));
  for (const key of ["deactive", "provisionalMember"]) {
    lines.push("", `${key}: distinct values with counts:`);
    for (const [k, n] of flagValues(key)) lines.push(`  ${String(n).padStart(5)}  ${key} = ${k}`);
  }
  lines.push("(deactive: empty, N, No, false, 0, null or active = active member; anything else = deactivated and dropped. provisionalMember true = kept and flagged.)");

  const parsed = parseNcaaDirectory(json);
  lines.push(`As parsed: ${parsed.filter((p) => p.deactivated).length} deactivated, ${parsed.filter((p) => p.provisional).length} provisional.`);
  const ids = new Set(parsed.map((p) => p.ncaaId).filter(Boolean));
  const names = new Set(parsed.map((p) => p.name.toLowerCase()));
  const nameState = new Set(parsed.map((p) => `${p.name.toLowerCase()}|${p.state}`));
  lines.push("", `Records read: ${parsed.length} of ${records.length}. Distinct school ids: ${ids.size || "(no id field found)"}. Distinct names: ${names.size}. Distinct name+state: ${nameState.size}.`);
  const byDiv = tally(parsed.map((p) => p.division || "(unreadable)"));
  lines.push(`Division as the parser reads it: ${byDiv.map(([d, n]) => `${d} ${n}`).join(", ")}`);

  // One sample per division the parser sees, then fill up to five.
  const picks: typeof parsed = [];
  for (const [d] of byDiv) {
    const p = parsed.find((x) => (x.division || "(unreadable)") === d);
    if (p && picks.length < 5) picks.push(p);
  }
  for (const p of parsed) if (picks.length < 5 && !picks.includes(p)) picks.push(p);
  lines.push("", "5 sample records (school name, division, conference, state, sport only):");
  for (const p of picks) {
    lines.push(`  ${p.name} | division ${p.rawDivision ?? "(none)"} -> ${p.division || "unreadable"} (${normalizeDivision(p.rawDivision) || "?"}) | ${p.conference || "(no conference)"} | ${p.state || "(no state)"} | sport ${p.rawSports?.join(",") || "(none)"}`);
  }
  return lines;
}

/** Describes every cached response from the directory host that holds a list of records. Reads files only. */
export function debugNcaaCache(cacheDir: string, host: string): string[] {
  const dir = join(cacheDir, host);
  if (!existsSync(dir)) return [`No cached pages for ${host} in ${cacheDir}. Run --build-schools once first.`];
  const out: string[] = [];
  let shown = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8")) as { url: string; status: number; body: string };
    if (c.url.endsWith("/robots.txt")) continue;
    if (c.status !== 200) {
      out.push(`--- ${c.url}: HTTP ${c.status} (no data) ---`, "");
      continue;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(c.body);
    } catch {
      out.push(`--- ${c.url}: not JSON (starts: ${JSON.stringify(c.body.slice(0, 80))}) ---`, "");
      continue;
    }
    out.push(...describeNcaa(json, c.url), "");
    shown++;
  }
  if (shown === 0 && out.length === 0) out.push(`No cached directory responses under ${dir}.`);
  return out;
}
