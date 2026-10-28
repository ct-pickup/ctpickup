/** A reason label from the match API ("Near you") as a short token ("near_you"). Labels are written by us, never by players. */
export function reasonCode(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
}

/** Up to two reason codes joined with a comma, short enough to be one allowed property value. */
export function reasonsProp(labels: string[] | undefined): string | undefined {
  const codes = (labels ?? []).map(reasonCode).filter(Boolean).slice(0, 2);
  const joined = codes.join(",");
  return joined ? joined.slice(0, 64) : undefined;
}
