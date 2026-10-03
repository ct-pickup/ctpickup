import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as webBrand from "@/lib/brand";
import * as mobileBrand from "../../mobile/lib/brand";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "mobile/app", "mobile/components"];

/**
 * The old product name and handle. "CT Pickup LLC" is the legal entity and stays.
 * Lowercase ctpickup (domain, scheme, storage keys) is not matched.
 */
const BANNED: Array<{ label: string; re: RegExp }> = [
  { label: "CT Pickup", re: /\bCT[ -]?[Pp]ickup\b(?! LLC)(?!\/)/ },
  { label: "@ctpickup", re: /@ctpickup\b(?!\.net)/i },
  { label: "instagram.com/ctpickup", re: /instagram\.com\/ctpickup\b/i },
  { label: "instagram://user?username=ctpickup", re: /username=ctpickup\b/i },
];

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?|json)$/.test(entry)) out.push(full);
  }
}

describe("brand", () => {
  it("names the product Competitive Together with a CT short mark", () => {
    expect(webBrand.PRODUCT_NAME).toBe("Competitive Together");
    expect(webBrand.SHORT_NAME).toBe("CT");
    expect(webBrand.TAGLINE).toBe("Good games. Better people.");
    expect(webBrand.LEGAL_ENTITY_NAME).toBe("CT Pickup LLC");
    expect(mobileBrand).toEqual(webBrand);
  });

  it("points Instagram links at @competitivetogether", () => {
    expect(webBrand.INSTAGRAM_HANDLE).toBe("competitivetogether");
    expect(webBrand.INSTAGRAM_VERIFICATION_HANDLE).toBe(webBrand.INSTAGRAM_HANDLE);
    expect(webBrand.INSTAGRAM_URL).toBe("https://instagram.com/competitivetogether");
    expect(webBrand.INSTAGRAM_APP_URL).toBe("instagram://user?username=competitivetogether");
  });

  it("has no user-facing CT Pickup or @ctpickup left in app and component code", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    expect(files.length).toBeGreaterThan(50);

    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const { label, re } of BANNED) {
            if (re.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1} ${label}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
