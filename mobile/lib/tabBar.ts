/**
 * Geometry of the custom tab bar in app/(tabs)/_layout.tsx. Screens that scroll
 * under it read their bottom padding from here so the two never drift apart.
 */

/** Bar content above the bottom safe area. */
export const TAB_BAR_CONTENT_HEIGHT = 60;

/** The bar never sits tighter than this to the bottom edge. */
export const TAB_BAR_MIN_INSET = 8;

/** Total height of the bar for a given bottom safe-area inset. */
export function tabBarHeight(insetBottom: number): number {
  return TAB_BAR_CONTENT_HEIGHT + Math.max(insetBottom, TAB_BAR_MIN_INSET);
}

/** Clearance so the last row of content is not covered by the bar. */
export function tabBarContentPadding(insetBottom: number, extra = 24): number {
  return tabBarHeight(insetBottom) + extra;
}
