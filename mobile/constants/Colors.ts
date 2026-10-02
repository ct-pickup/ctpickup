import { darkColor, lightColor, palette } from "@theme/tokens";

/** @deprecated Prefer useTheme() from @/theme. Kept so older call sites keep compiling. */
const Colors = {
  light: {
    text: lightColor.text,
    background: lightColor.bg,
    tint: palette.pitch,
    tabIconDefault: lightColor.muted,
    tabIconSelected: palette.pitch,
  },
  dark: {
    text: darkColor.text,
    background: darkColor.bg,
    tint: palette.pitch,
    tabIconDefault: darkColor.muted,
    tabIconSelected: darkColor.text,
  },
};

export default Colors;

export const CT_PICKUP_LIME = palette.pitch;
