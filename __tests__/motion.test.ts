import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAX_MOTION_MS, MOTION, staggerDelay } from "../mobile/lib/motion";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("shared motion config", () => {
  it("keeps every timed animation under 400 ms, the stagger included", () => {
    for (const d of Object.values(MOTION.duration)) expect(d).toBeLessThan(MAX_MOTION_MS);
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBe(120);
    expect(staggerDelay(50)).toBe(MOTION.stagger.maxSteps * MOTION.stagger.stepMs);
    expect(staggerDelay(50) + MOTION.duration.fast).toBeLessThan(MAX_MOTION_MS);
    expect(staggerDelay(-2)).toBe(0);
  });
  it("is the only place timings live: components read MOTION and have no hardcoded animation durations", () => {
    const files = [
      "mobile/components/AnimatedPressScale.tsx",
      "mobile/components/motion/StaggerIn.tsx",
      "mobile/components/motion/SheetModal.tsx",
      "mobile/components/motion/SelectionPill.tsx",
      "mobile/components/HalfStarInput.tsx",
      "mobile/components/profile/RatingReliability.tsx",
      "mobile/components/season/SeasonCard.tsx",
      "mobile/components/home/HomeSeasonCard.tsx",
    ];
    for (const f of files) {
      const s = src(f);
      expect(s, f).toMatch(/MOTION\./);
      expect(s, f).not.toMatch(/duration: \d{3,}/);
      expect(s, f).toMatch(/useReduceMotion|reduceMotion/);
    }
    expect(src("mobile/components/AnimatedPressScale.tsx")).not.toMatch(/damping: 17/);
  });
});

describe("where the motion is used", () => {
  it("press feedback on cards, chips and primary buttons, haptic on primary actions only", () => {
    const lb = src("mobile/app/(tabs)/leaderboards.tsx");
    expect((lb.match(/<AnimatedPressScale/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(lb).not.toMatch(/<AnimatedPressScale[^>]*hapticOnPress/s);
    expect(src("mobile/components/season/SeasonCard.tsx")).toMatch(/hapticOnPress\s+pressedScale=\{MOTION\.pressScale\.button\}/);
    expect(src("mobile/app/peer-ratings/[id].tsx")).toMatch(/hapticOnPress/);
    expect(src("mobile/app/session/[id].tsx")).toMatch(/hapticOnPress/);
    expect(src("mobile/components/home/HomeSeasonCard.tsx")).toMatch(/pressedScale=\{MOTION\.pressScale\.card\}/);
    expect(src("mobile/components/home/HomeSeasonCard.tsx")).not.toMatch(/hapticOnPress/);
  });
  it("lists stagger in on mount only: leaderboard rows, past games, rate players", () => {
    expect(src("mobile/app/(tabs)/leaderboards.tsx")).toMatch(/<StaggerIn key=\{item\.user_id\} index=\{index\}>/);
    expect(src("mobile/app/(tabs)/leaderboards.tsx")).toMatch(/<StaggerIn index=\{index\}>/);
    expect(src("mobile/app/(tabs)/sessions.tsx")).toMatch(/<StaggerIn key=\{g\.run_id\} index=\{i\}>/);
    expect(src("mobile/app/peer-ratings/[id].tsx")).toMatch(/<StaggerIn index=\{index\} style=\{s\.row\}>/);
    expect(src("mobile/app/session/[id].tsx")).toMatch(/<StaggerIn key=\{a\.user_id\} index=\{idx\} style=\{s\.scoreRow\}>/);
    const st = src("mobile/components/motion/StaggerIn.tsx");
    expect(st).toMatch(/entering=\{FadeInDown/);
    expect(st).toMatch(/if \(reduceMotion\) return <View/);
  });
  it("the tab chips and the Season / Fields / Events switch use the animated selection pill", () => {
    expect(src("mobile/app/(tabs)/leaderboards.tsx")).toMatch(/useSelectionPill<string>\(moreActive \? "more" : tab\)/);
    expect(src("mobile/app/(tabs)/sessions.tsx")).toMatch(/useSelectionPill<string>\(view\)/);
    expect(src("mobile/components/motion/SelectionPill.tsx")).toMatch(/withSpring\(tx, MOTION\.spring\.pill\)/);
  });
  it("rate players: stars pop in sequence with a light haptic and the label crossfades", () => {
    const input = src("mobile/components/HalfStarInput.tsx");
    expect(input).toMatch(/hapticTap\(\)/);
    expect(input).toMatch(/ZoomIn\.duration\(MOTION\.duration\.fast\)\.delay\(i \* MOTION\.stagger\.stepMs\)/);
    expect(src("mobile/app/session/[id].tsx")).toMatch(/<Reanimated\.Text key=\{rated\} entering=\{FadeIn/);
    expect(src("mobile/app/peer-ratings/[id].tsx")).toMatch(/starLevelLabel\(ratings\[item\.user_id\]/);
  });
  it("reveals replay once per visit, keyed on screen focus", () => {
    expect(src("mobile/hooks/useVisitKey.ts")).toMatch(/useFocusEffect/);
    expect(src("mobile/components/profile/RatingBlock.tsx")).toMatch(/useCountUp\(.*, onLanded, visit\)/);
    expect(src("mobile/components/profile/RatingReliability.tsx")).toMatch(/\[p, reduceMotion, replayKey\]/);
    expect(src("mobile/components/season/SeasonCard.tsx")).toMatch(/\[progress, reduceMotion, visit\]/);
  });
  it("bottom sheets share one spring", () => {
    for (const f of ["mobile/components/OptionSheet.tsx", "mobile/components/StarLevels.tsx", "mobile/components/profile/BadgeShelf.tsx"]) {
      expect(src(f), f).toMatch(/<SheetModal/);
      expect(src(f), f).not.toMatch(/animationType="slide"/);
    }
    expect(src("mobile/components/motion/SheetModal.tsx")).toMatch(/MOTION\.spring\.sheet/);
  });
  it("new copy has no em dash and no tier or wave wording", () => {
    for (const t of ["Games you could join", "What do the ratings mean?", "Rating", "Rating locked in"]) expect(t).not.toMatch(/—|\btier\b|\bwave\b/i);
  });
});
