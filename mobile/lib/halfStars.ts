/** Half-star math for the peer rating sheet. Values run 0.5-5.0 in 0.5 steps. */

export const MAX_STARS = 5;

/** Value for a tap at `x` inside a star `width` wide, on star `index` (0-based). Left half = .5. */
export function starValueFromTap(index: number, x: number, width: number): number {
  const left = width > 0 && x < width / 2;
  return index + (left ? 0.5 : 1);
}

export function isValidHalfStar(v: number): boolean {
  return Number.isFinite(v) && v >= 0.5 && v <= MAX_STARS && v * 2 === Math.floor(v * 2);
}

/** Fill of star `index` (0-based) for a rating `value`: 0, 0.5 or 1. */
export function starFill(index: number, value: number): 0 | 0.5 | 1 {
  const halves = Math.round(value * 2);
  return halves >= (index + 1) * 2 ? 1 : halves === index * 2 + 1 ? 0.5 : 0;
}
