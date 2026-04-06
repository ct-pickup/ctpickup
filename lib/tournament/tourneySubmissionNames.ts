/**
 * `tourney_submissions` stores split names (`first_name`, `last_name`), not `full_name`.
 * Intake/chat flows may still collect a single string; map it here for writes and display.
 */
export function splitFullNameToFirstLast(fullName: string): { first_name: string; last_name: string } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  if (!trimmed) return { first_name: "", last_name: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function tourneySubmissionDisplayName(row: {
  first_name?: string | null;
  last_name?: string | null;
  meta?: unknown;
}): string {
  const a = String(row.first_name ?? "").trim();
  const b = String(row.last_name ?? "").trim();
  const joined = [a, b].filter(Boolean).join(" ");
  if (joined) return joined;

  const m =
    row.meta && typeof row.meta === "object" && row.meta !== null
      ? (row.meta as Record<string, unknown>)
      : null;
  const legacy = String(m?.intake_full_name ?? m?.full_name ?? "").trim();
  return legacy || "—";
}
