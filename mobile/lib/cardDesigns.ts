/** Share-card designs. "classic" is the free card and is rendered by PlayerCard's share variant, unchanged. */
export type CardDesignId = "classic" | "dark" | "gold" | "club";
export type CardSizeId = "story" | "square";

export type CardDesign = { id: CardDesignId; name: string; premium: boolean };

export const CARD_DESIGNS: readonly CardDesign[] = [
  { id: "classic", name: "Classic", premium: false },
  { id: "dark", name: "Dark", premium: true },
  { id: "gold", name: "Gold", premium: true },
  { id: "club", name: "Club", premium: true },
];

export const CARD_SIZES: Record<CardSizeId, { label: string; width: number; height: number }> = {
  story: { label: "Story", width: 1080, height: 1920 },
  square: { label: "Square", width: 1080, height: 1080 },
};

export function isPremiumDesign(id: CardDesignId): boolean {
  return CARD_DESIGNS.find((d) => d.id === id)?.premium ?? false;
}
