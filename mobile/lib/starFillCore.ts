/**
 * Fill math for the star row. The stored half star decides the stars (gates and hysteresis live in the database); the exact rating
 * only sets how far the last star is filled, so a 3.35 shows 3 full stars and a 4th star about a third full.
 */

export const STAR_COUNT = 5;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The exact rating is used only when it is a real rating that rounds (to the nearest half) to the stored star. */
export function usableExact(star: number | null | undefined, exact: number | null | undefined): number | null {
  if (!finite(star) || !finite(exact)) return null;
  if (exact < 0.5 || exact > STAR_COUNT) return null;
  return Math.round(exact * 2) / 2 === Math.round(star * 2) / 2 ? exact : null;
}

/** Fill of each of the 5 stars, 0 to 1 from the left. Exact rating when usable, else the half stars of the stored rating, else all empty. */
export function starFills(star: number | null | undefined, exact?: number | null): number[] {
  const ex = usableExact(star, exact);
  if (ex != null) return Array.from({ length: STAR_COUNT }, (_, i) => Math.round(Math.min(1, Math.max(0, ex - i)) * 100) / 100);
  if (!finite(star)) return Array.from({ length: STAR_COUNT }, () => 0);
  const halves = Math.round(Math.min(STAR_COUNT, Math.max(0, star)) * 2);
  return Array.from({ length: STAR_COUNT }, (_, i) => (halves >= (i + 1) * 2 ? 1 : halves === i * 2 + 1 ? 0.5 : 0));
}

/** The number beside the stars: two decimals from the exact rating, else the stored star with one decimal as before. */
export function starNumberText(star: number, exact?: number | null): string {
  const ex = usableExact(star, exact);
  return ex != null ? ex.toFixed(2) : Math.min(STAR_COUNT, Math.max(0, star)).toFixed(1);
}
