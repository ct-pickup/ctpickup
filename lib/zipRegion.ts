import { stateFromUsZipFive } from "@/lib/usZipState";

const HUB_STATE_TO_REGION_NAME: Record<string, string> = {
  CT: "Connecticut",
  NY: "New York",
  NJ: "New Jersey",
  MD: "Maryland",
};

/** Normalize user input to exactly five US ZIP digits (pads leading zeros). */
export function normalizeUsZipDigits(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const digits = String(zip).replace(/\D/g, "");
  if (!digits) return null;
  const padded = digits.length <= 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
  return /^\d{5}$/.test(padded) ? padded : null;
}

/** Hub region display name (Connecticut, New York, …) from a ZIP string, or null. */
export function displayRegionNameFromZip(zip: string | null | undefined): string | null {
  const zip5 = normalizeUsZipDigits(zip);
  if (!zip5) return null;
  const code = stateFromUsZipFive(zip5);
  if (!code) return null;
  return HUB_STATE_TO_REGION_NAME[code] ?? null;
}
