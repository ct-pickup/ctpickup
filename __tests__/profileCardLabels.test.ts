import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ratingDisplay } from "../mobile/lib/ratingDisplayCore";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const texts = ["mobile/components/profile/PlayerGameStats.tsx", "mobile/components/profile/RatingBlock.tsx", "mobile/components/profile/RatingReliability.tsx", "mobile/app/player/[id].tsx", "mobile/components/profile/ProfileCard.tsx"];

describe("profile card labels", () => {
  it("says Avg teammate, not Avg partner", () => {
    const s = src("mobile/components/profile/PlayerGameStats.tsx");
    expect(s).toContain('label="Avg teammate"');
    expect(s).not.toContain("Avg partner");
    expect(s).toContain('label="Avg opponent"');
  });
  it("has no 'X stars' text next to the stars: only the stars, the decimal and the Verified mark", () => {
    const block = src("mobile/components/profile/RatingBlock.tsx");
    expect(block).not.toMatch(/starsText/);
    expect(block).toMatch(/Verified/);
    expect(block).toMatch(/display\.number/);
    expect(Object.keys(ratingDisplay({ star: 3.5, exact: 3.62, ratedGames: 3, settledGames: 5, provisional: true }))).not.toContain("starsText");
  });
  it("labels the attendance ring Shows up everywhere, visible and spoken", () => {
    const ring = src("mobile/components/profile/RatingReliability.tsx");
    expect(ring).toMatch(/Shows up\s*\n\s*<\/Text>/);
    expect(ring).toContain("Shows up ${clamped} percent");
    for (const f of texts) expect(src(f), f).not.toMatch(/>\s*Reliab(le|ility)\s*</);
  });
  it("drops the visible 'Full name' caption but keeps it for screen readers on the name", () => {
    const screen = src("mobile/app/player/[id].tsx");
    expect(screen).not.toMatch(/<Text[^>]*>\s*Full name\s*<\/Text>/);
    expect(screen).toMatch(/accessibilityLabel=\{`Full name: \$\{profile\.display_name\}`\}/);
    expect(screen).not.toContain("heroLabel");
  });
  it("copy has no em dash and no tier or wave wording", () => {
    for (const f of texts) {
      const strings = [...src(f).matchAll(/>\s*([A-Z][A-Za-z' ]{2,30})\s*</g)].map((m) => m[1]);
      for (const t of strings) expect(t, f).not.toMatch(/—|\btier\b|\bwave\b/i);
    }
  });
});
