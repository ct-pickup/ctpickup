/** Keep ZIP → hub region logic aligned with `lib/zipRegion.ts` / `lib/usZipState.ts`. */

function normalizeUsZipDigits(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "");
  if (!digits) return null;
  const padded = digits.length <= 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
  return /^\d{5}$/.test(padded) ? padded : null;
}

/**
 * Hub region display name from a US ZIP (pads leading zeros; uses 3-digit prefix ranges).
 * CT: 060–069 (e.g. 06511 → Connecticut).
 */
export function displayRegionNameFromZip(zip: string | null | undefined): string | null {
  const zip5 = normalizeUsZipDigits(zip);
  if (!zip5) return null;

  if (__DEV__) {
    console.log("[zipRegion] displayRegionNameFromZip", { raw: zip, zip5, prefix3: zip5.slice(0, 3) });
  }

  const prefix = Number.parseInt(zip5.slice(0, 3), 10);
  if (!Number.isFinite(prefix)) return null;
  if (prefix >= 60 && prefix <= 69) return "Connecticut";
  if (prefix >= 100 && prefix <= 149) return "New York";
  if (prefix >= 70 && prefix <= 89) return "New Jersey";
  if (prefix >= 200 && prefix <= 219) return "Maryland";
  return null;
}
