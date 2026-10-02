import { Image, StyleSheet } from "react-native";

import { GRAIN_OPACITY } from "@/theme";

const GRAIN = require("../../assets/grain.png");

/** Tiling low-opacity noise over a photo or the player card. Fills its parent. */
export default function GrainOverlay() {
  return <Image source={GRAIN} resizeMode="repeat" style={[StyleSheet.absoluteFill, { opacity: GRAIN_OPACITY }]} />;
}
