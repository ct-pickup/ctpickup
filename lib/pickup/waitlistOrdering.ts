/** Row shape used to determine the next waitlist promotion candidate. */
export type WaitlistCandidateRow = {
  user_id: string;
  waitlist_position: number | null;
  created_at: string;
};

/** Sort waitlist RSVPs: lowest `waitlist_position` first, then earliest `created_at`. */
export function sortWaitlistCandidates<T extends WaitlistCandidateRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ap =
      a.waitlist_position === null || a.waitlist_position === undefined
        ? Number.MAX_SAFE_INTEGER
        : Number(a.waitlist_position);
    const bp =
      b.waitlist_position === null || b.waitlist_position === undefined
        ? Number.MAX_SAFE_INTEGER
        : Number(b.waitlist_position);
    if (ap !== bp) return ap - bp;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export function pickNextWaitlistCandidate<T extends WaitlistCandidateRow>(rows: T[]): T | null {
  const sorted = sortWaitlistCandidates(rows);
  return sorted[0] ?? null;
}
