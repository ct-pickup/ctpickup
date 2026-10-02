// Fails when code reads the legacy player_cards columns (tier, verification,
// sessions, reliability). They were re-added in
// 20261002230000_player_cards_legacy_columns.sql only for App Store v1.3.5 and
// are dropped on 2026-12-01 together with lib/api/appVersion.ts. Delete this
// check once the view is back to the 20261002190000 definition.
//
// Run: node scripts/check-player-cards.mjs (also runs in `npx vitest run`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SCAN_DIRS = [
  "mobile/app",
  "mobile/components",
  "mobile/lib",
  "mobile/dev-fixtures",
  "app",
  "lib",
  "components",
];

export const ALLOWED_FILES = new Set([
  "lib/api/appVersion.ts",
  "lib/api/appVersion.test.ts",
  "__tests__/security/legacyAppCompat.test.ts",
]);

const LEGACY_COLUMN_RE = /(?<![\w.])(tier|verification|sessions|reliability)(?!\w)|(?<![\w.])\*(?![\w])/;
const FROM_RE = /\.from\(\s*(["'`])player_cards\1\s*\)/g;
const EMBED_RE = /(?<!\w)player_cards\s*(?:!\s*\w+\s*)?\(/g;
const CHAIN_END_RE = /\.from\(|;/g;
const SKIPPED_DIRS = new Set(["node_modules", ".next", ".expo", "images"]);

/** Blanks out comment lines so line numbers stay correct. */
function stripCommentLines(source) {
  return source
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : line;
    })
    .join("\n");
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Reads the string literal starting at `start` (a quote char). Returns its body and end index. */
function readStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let out = "";
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      out += source[i + 1] ?? "";
      i++;
      continue;
    }
    if (ch === quote) return { body: out, end: i + 1 };
    out += ch;
  }
  return null;
}

/** Reads `(...)` starting at the open paren, balancing nested parens. */
function readParens(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/**
 * Concatenates every string literal inside a select(...) argument, so "a," + "tier" still counts.
 * A bare identifier such as select(CARD_COLUMNS) resolves to `const CARD_COLUMNS = "..."` in the same file.
 */
function selectArgumentText(arg, source) {
  const ident = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(arg);
  if (ident) {
    const decl = new RegExp(`(?:const|let|var)\\s+${ident[1].replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*`).exec(source);
    if (!decl) return "";
    const start = decl.index + decl[0].length;
    const end = source.indexOf(";", start);
    return selectArgumentText(source.slice(start, end === -1 ? undefined : end), "");
  }
  let text = "";
  for (let i = 0; i < arg.length; i++) {
    const lit = readStringLiteral(arg, i);
    if (lit) {
      text += lit.body + "\n";
      i = lit.end - 1;
    }
  }
  return text;
}

/**
 * Returns `{ line, kind, snippet }` for every legacy player_cards read in `source`.
 * Catches `.from("player_cards")...select("...tier...")` (any number of lines and chained
 * calls in between) and embedded selects such as `player_cards(tier)` or
 * `card:player_cards!fk(sessions)`. `select("*")` counts, since it includes the legacy columns.
 */
export function findLegacyPlayerCardsReads(rawSource) {
  const source = stripCommentLines(rawSource);
  const hits = [];

  for (const m of source.matchAll(FROM_RE)) {
    const after = m.index + m[0].length;
    CHAIN_END_RE.lastIndex = after;
    const chainEnd = CHAIN_END_RE.exec(source);
    const chain = source.slice(after, chainEnd ? chainEnd.index : source.length);
    const sel = /\.select\(/.exec(chain);
    if (!sel) continue;
    const selOpen = after + sel.index + sel[0].length - 1;
    const text = selectArgumentText(readParens(source, selOpen), source);
    const col = LEGACY_COLUMN_RE.exec(text);
    if (col) {
      hits.push({
        line: lineAt(source, m.index),
        kind: `.from("player_cards").select reads "${col[0]}"`,
        snippet: text.replace(/\s+/g, " ").trim(),
      });
    }
  }

  for (const m of source.matchAll(EMBED_RE)) {
    const open = m.index + m[0].length - 1;
    const inner = readParens(source, open);
    const col = LEGACY_COLUMN_RE.exec(inner);
    if (col) {
      hits.push({
        line: lineAt(source, m.index),
        kind: `embedded player_cards(...) reads "${col[0]}"`,
        snippet: `player_cards(${inner.replace(/\s+/g, " ").trim()})`,
      });
    }
  }

  return hits.sort((a, b) => a.line - b.line);
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry)) out.push(path);
  }
}

export function checkPlayerCards(baseDir = root) {
  const failures = [];
  for (const dir of SCAN_DIRS) {
    const files = [];
    walk(join(baseDir, dir), files);
    for (const file of files) {
      const rel = relative(baseDir, file).split(sep).join("/");
      if (ALLOWED_FILES.has(rel)) continue;
      for (const hit of findLegacyPlayerCardsReads(readFileSync(file, "utf8"))) {
        failures.push(`${rel}:${hit.line} ${hit.kind}: ${hit.snippet}`);
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkPlayerCards();
  if (failures.length) {
    console.error(
      "player_cards legacy columns (tier, verification, sessions, reliability) are for App Store v1.3.5 only " +
        "and are dropped on 2026-12-01. Read star_rating, star_provisional and percentile instead:",
    );
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`player_cards check passed (${SCAN_DIRS.length} directories)`);
}
