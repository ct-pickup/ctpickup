import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enforced = readFileSync(join(root, "shared/theme/enforced.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const hexRe = /#[0-9A-Fa-f]{3,8}\b|rgba?\(/;
const paletteRe =
  /\b(?:bg|text|border|from|to|via|ring|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?(?:\/\d+|\[[^\]]+\])?\b/;
const classFlagRe = /(?:^|[\s"'`])(?:uppercase|tracking-[^\s"'`]+|shadow-[^\s"'`]+|drop-shadow[^\s"'`]*)(?=$|[\s"'`])/;
const rnRe =
  /textTransform\s*:\s*["']uppercase["']|letterSpacing\s*:|shadow(?:Color|Opacity|Radius|Offset)\s*:|elevation\s*:/;

const allowNames = new Set(["tokens.ts", "theme.css"]);
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "api" || entry === ".expo") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(tsx|ts|css)$/.test(entry)) continue;
    if (allowNames.has(entry)) continue;
    const rel = relative(root, path);
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      const at = `${rel}:${index + 1}`;
      if (hexRe.test(line)) failures.push(`${at} raw color: ${line.trim()}`);
      if (paletteRe.test(line) || classFlagRe.test(line)) failures.push(`${at} palette/uppercase/tracking/shadow: ${line.trim()}`);
      if (/\.(tsx|ts)$/.test(entry) && rnRe.test(line)) failures.push(`${at} native style flag: ${line.trim()}`);
    });
  }
}

for (const dir of enforced) walk(join(root, dir));

const emitted = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "scripts/emit-theme-css.ts", "--check"],
  { cwd: root, encoding: "utf8" },
);
if (emitted.status !== 0) {
  failures.push((emitted.stderr || emitted.stdout || "theme.css check failed").trim());
}

if (failures.length) {
  console.error(failures.slice(0, 40).join("\n"));
  if (failures.length > 40) console.error(`…and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`theme check passed (${enforced.length} directories)`);
