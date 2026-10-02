import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { darkColor, lightColor, palette, radius, typeScale } from "../shared/theme/tokens.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function vars(color: typeof lightColor): string {
  return [
    `  --canvas: ${color.bg};`,
    `  --card: ${color.card};`,
    `  --ink: ${color.text};`,
    `  --muted: ${color.muted};`,
    `  --line: ${color.line};`,
    `  --pitch: ${color.pitch};`,
    `  --pitch-text: ${color.pitchText};`,
    `  --pitch-soft: ${color.pitchSoft};`,
    `  --pitch-panel: ${color.pitchPanel};`,
    `  --on-pitch-panel: ${color.onPitchPanel};`,
    `  --coral: ${color.coral};`,
    `  --coral-text: ${color.coralText};`,
    `  --on-pitch: ${color.onPitch};`,
    `  --overlay-subtle: ${color.overlaySubtle};`,
    `  --overlay: ${color.overlay};`,
    `  --overlay-strong: ${color.overlayStrong};`,
    `  --scrim: ${color.scrim};`,
    `  --chalk: ${palette.chalk};`,
    `  --paper: ${palette.paper};`,
    `  --ink-solid: ${palette.ink};`,
    `  --ink-card: ${palette.inkCard};`,
  ].join("\n");
}

const css = `/* Generated from shared/theme/tokens.ts. Do not edit by hand. */
:root {
${vars(lightColor)}
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
${vars(darkColor)}
    color-scheme: dark;
  }
}

@theme inline {
  --color-canvas: var(--canvas);
  --color-card: var(--card);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-pitch: var(--pitch);
  --color-pitch-text: var(--pitch-text);
  --color-pitch-soft: var(--pitch-soft);
  --color-pitch-panel: var(--pitch-panel);
  --color-on-pitch-panel: var(--on-pitch-panel);
  --color-coral: var(--coral);
  --color-coral-text: var(--coral-text);
  --color-on-pitch: var(--on-pitch);
  --color-overlay-subtle: var(--overlay-subtle);
  --color-overlay: var(--overlay);
  --color-overlay-strong: var(--overlay-strong);
  --color-scrim: var(--scrim);
  --color-chalk: var(--chalk);
  --color-paper: var(--paper);
  --color-ink-solid: var(--ink-solid);
  --color-ink-card: var(--ink-card);
  --font-sans: var(--font-sans), ui-sans-serif, system-ui, sans-serif;
  --font-serif: var(--font-serif), Georgia, "Times New Roman", serif;
  --radius-card: ${radius.card}px;
  --radius-button: ${radius.button}px;
  --radius-pill: ${radius.pill}px;
  --text-micro: ${typeScale.micro}px;
  --text-micro--line-height: 1.3;
  --text-caption: ${typeScale.caption}px;
  --text-caption--line-height: 1.35;
  --text-small: ${typeScale.small}px;
  --text-small--line-height: 1.45;
  --text-body: ${typeScale.body}px;
  --text-body--line-height: 1.5;
  --text-h3: ${typeScale.h3}px;
  --text-h3--line-height: 1.3;
  --text-h2: ${typeScale.h2}px;
  --text-h2--line-height: 1.25;
  --text-h1: ${typeScale.h1}px;
  --text-h1--line-height: 1.15;
  --text-display: ${typeScale.display}px;
  --text-display--line-height: 1.1;
  --text-display-xl: ${typeScale.displayXL}px;
  --text-display-xl--line-height: 1.05;
}
`;

const out = resolve(root, "app/theme.css");
if (process.argv.includes("--check")) {
  const current = readFileSync(out, "utf8");
  if (current !== css) {
    console.error("app/theme.css is out of date. Run: node --experimental-strip-types scripts/emit-theme-css.ts");
    process.exit(1);
  }
  console.log("app/theme.css matches tokens");
} else {
  writeFileSync(out, css);
  console.log("wrote", out);
}
