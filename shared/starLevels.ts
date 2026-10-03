/**
 * Named star levels, shared by the app and the server.
 * Mirrored in SQL by public.star_levels (see supabase/migrations/20261005000000_star_levels.sql);
 * __tests__/starLevels.test.ts keeps the two in sync.
 * Players see the star, name and description only. Never scores, bands or math.
 */

export type StarLevel = {
  star: number;
  name: string;
  description: string;
};

/** Highest first. */
export const STAR_LEVELS: readonly StarLevel[] = [
  {
    star: 5.0,
    name: "Pro",
    description:
      "Current or former pro (MLS, NWSL, MLS NEXT Pro, USL Championship, USL League One, top leagues abroad)",
  },
  { star: 4.5, name: "Elite", description: "USL League Two starter, WPSL starter, or D1 starter" },
  {
    star: 4.0,
    name: "College",
    description: "D1 roster, D2/D3 starter, USL League Two or WPSL roster (non-starter), top ECNL/MLS NEXT",
  },
  { star: 3.5, name: "Advanced", description: "D2/D3/NAIA/JUCO player, high-level club, varsity standout" },
  { star: 3.0, name: "Competitive", description: "High school varsity, travel club, competitive adult league" },
  { star: 2.5, name: "Solid", description: "JV or strong adult league regular" },
  { star: 2.0, name: "Recreational", description: "Plays casually, comfortable on the ball" },
  { star: 1.5, name: "Developing", description: "" },
  { star: 1.0, name: "Beginner", description: "" },
  { star: 0.5, name: "New", description: "" },
];

/** True for exactly one of the half-star levels above. */
export function isStarLevel(value: unknown): value is number {
  return typeof value === "number" && STAR_LEVELS.some((l) => l.star === value);
}

/** Level for a displayed star, rounded to the nearest half. */
export function starLevelFor(star: number | null | undefined): StarLevel | null {
  if (star == null || !Number.isFinite(star)) return null;
  const half = Math.round(Math.min(5, Math.max(0.5, star)) * 2) / 2;
  return STAR_LEVELS.find((l) => l.star === half) ?? null;
}

export function starLevelName(star: number | null | undefined): string | null {
  return starLevelFor(star)?.name ?? null;
}

/** "4.0 · College" for pickers and admin rows. */
export function starLevelLabel(star: number | null | undefined): string | null {
  const level = starLevelFor(star);
  return level ? `${level.star.toFixed(1)} · ${level.name}` : null;
}
