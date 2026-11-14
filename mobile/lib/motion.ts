/**
 * The one motion config. Every animation in the app reads its timing from here, so the feel stays consistent and nothing
 * runs longer than MAX_MOTION_MS. Components still check Reduce Motion themselves (useReduceMotion) before animating.
 */
export const MAX_MOTION_MS = 400;

export const MOTION = {
  /** Timed animations, in ms. */
  duration: {
    /** Press feedback and tiny state flips. */
    press: 120,
    /** Fades, label crossfades, list rows. */
    fast: 180,
    /** Bars filling, reveals. */
    base: 240,
    /** The longest a single timed animation may take. */
    slow: 360,
  },
  /** Staggered list entrances: each row waits stepMs more than the last, up to maxSteps rows. */
  stagger: { stepMs: 40, maxSteps: 5 },
  /** Springs settle in roughly 250 to 350 ms with these values. */
  spring: {
    press: { damping: 17, stiffness: 420, mass: 0.35 },
    pill: { damping: 20, stiffness: 320, mass: 0.6 },
    sheet: { damping: 24, stiffness: 280, mass: 0.8 },
    pop: { damping: 12, stiffness: 380, mass: 0.5 },
  },
  /** Press scale for cards, chips and buttons. */
  pressScale: { card: 0.98, chip: 0.95, button: 0.97 },
} as const;

/** Delay before row `index` enters. Capped so the whole stagger plus the row's own fade stays under MAX_MOTION_MS. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index), MOTION.stagger.maxSteps) * MOTION.stagger.stepMs;
}
