export function pickupPublicPayloadRunId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const run = (json as Record<string, unknown>).run;
  if (!run || typeof run !== "object") return null;
  const id = (run as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** True when the body includes a `run` object whose id matches the requested inline/deep-link run. */
export function pickupPublicPayloadMatchesRunId(json: unknown, expectedRunId: string | undefined): boolean {
  if (!expectedRunId?.trim()) return pickupPublicPayloadRunId(json) != null;
  const id = pickupPublicPayloadRunId(json);
  return id === expectedRunId.trim();
}
