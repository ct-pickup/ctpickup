/** Collapse whitespace for stable label comparison. */
export function normalizeSlotLabelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

/** Legacy chips used ASCII hyphens; presets use en-dashes (e.g. `10am-12pm` vs `10am – 12pm`). */
export function slotLabelLookupVariants(label: string): string[] {
  const base = normalizeSlotLabelKey(label);
  if (!base) return [];
  const variants = new Set<string>([base]);
  variants.add(base.replace(/-/g, "–").replace(/\s*–\s*/g, " – "));
  variants.add(base.replace(/\s*–\s*/g, "-").replace(/–/g, "-"));
  variants.add(base.replace(/-/g, " – "));
  return [...variants].map(normalizeSlotLabelKey).filter((v) => v.length > 0);
}

export function slotLabelsMatch(a: string, b: string): boolean {
  const va = slotLabelLookupVariants(a);
  const vb = slotLabelLookupVariants(b);
  return va.some((x) => vb.includes(x));
}
