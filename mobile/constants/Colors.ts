// CT Pickup palette
// Light mode background should match CT Pickup logo green.
export const CT_PICKUP_LIME = "#a3e635";
const tintColorLight = CT_PICKUP_LIME;
const tintColorDark = "#fff";

export default {
  light: {
    text: "#0a0a0a",
    background: CT_PICKUP_LIME,
    tint: tintColorLight,
    tabIconDefault: "rgba(10,10,10,0.35)",
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: "#fff",
    background: "#0a0a0a",
    tint: tintColorDark,
    tabIconDefault: "rgba(255,255,255,0.35)",
    tabIconSelected: tintColorDark,
  },
};
