/** Supabase Storage bucket for score screenshots (private; access via signed URLs from API). */
export const ESPORTS_MATCH_PROOFS_BUCKET = "esports-match-proofs";

/** Default confirmation window if tournament row is missing hours (should not happen). */
export const DEFAULT_CONFIRMATION_DEADLINE_HOURS = 48;

export const PROOF_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB

export const PROOF_ALLOWED_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
