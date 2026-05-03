/**
 * US states where CT Pickup operates.
 *
 * **Storage / API:** use `code` (USPS uppercase: NY, CT, NJ, MD).
 * **UI:** use `name`, or helpers below for multi-state copy.
 */
export const SERVICE_REGIONS = [
  { code: "NY" as const, name: "New York" },
  { code: "CT" as const, name: "Connecticut" },
  { code: "NJ" as const, name: "New Jersey" },
  { code: "MD" as const, name: "Maryland" },
] as const;

export type ServiceRegionCode = (typeof SERVICE_REGIONS)[number]["code"];

const CODE_SET = new Set<string>(SERVICE_REGIONS.map((r) => r.code));

export function isServiceRegionCode(value: string): value is ServiceRegionCode {
  return CODE_SET.has(value);
}

/** e.g. `NY · CT · NJ · MD` — good for badges, footers, tight UI */
export function formatServiceRegionsDot(): string {
  return SERVICE_REGIONS.map((r) => r.code).join(" · ");
}

/** e.g. `NY, CT, NJ, MD` — compact, tables, filters */
export function formatServiceRegionsComma(): string {
  return SERVICE_REGIONS.map((r) => r.code).join(", ");
}

/** e.g. `New York, Connecticut, New Jersey, and Maryland` — sentences, marketing */
export function formatServiceRegionsSentence(): string {
  const names = SERVICE_REGIONS.map((r) => r.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Lookup display name for a stored code (unknown codes pass through). */
export function serviceRegionName(code: string): string {
  const row = SERVICE_REGIONS.find((r) => r.code === code);
  return row?.name ?? code;
}
