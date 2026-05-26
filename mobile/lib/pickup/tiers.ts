export type Tier = "T1A" | "T1B" | "T2" | "T3" | "T4" | "TPUBLIC";

export function tiersForPhase(runType: "select" | "public", phase: number): Tier[] {
  if (runType === "select") {
    if (phase <= 0) return ["T1A", "T1B"];
    if (phase === 1) return ["T1A", "T1B", "T2"];
    if (phase === 2) return ["T1A", "T1B", "T2", "T3"];
    return ["T1A", "T1B", "T2", "T3", "T4"];
  }
  if (phase <= 0) return ["T1A", "T1B"];
  if (phase === 1) return ["T1A", "T1B", "T2"];
  if (phase === 2) return ["T1A", "T1B", "T2", "T3"];
  if (phase === 3) return ["T1A", "T1B", "T2", "T3", "T4"];
  return ["T1A", "T1B", "T2", "T3", "T4", "TPUBLIC"];
}

export function canSeeAttendance(userTier: Tier, runType: "select" | "public", phase: number): boolean {
  return tiersForPhase(runType, phase).includes(userTier);
}
