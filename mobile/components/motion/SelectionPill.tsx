import { useCallback, useState } from "react";
import { StyleSheet, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION } from "@/lib/motion";
import { themeColor, useThemedStyles } from "@/theme";

type Box = { x: number; y: number; width: number; height: number };

/**
 * An animated selection pill for a row of chips or segments. Each option reports its layout with `onLayoutFor(id)`; the pill
 * springs to the selected one (jumps under Reduce Motion). Render <SelectionPill/> as the first child of the row (behind the
 * options) and keep the selected option's own background transparent once `ready` is true.
 */
export function useSelectionPill<T extends string>(selected: T) {
  const reduceMotion = useReduceMotion();
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const onLayoutFor = useCallback(
    (id: T) => (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      setBoxes((prev) => {
        const cur = prev[id];
        if (cur && cur.x === x && cur.y === y && cur.width === width && cur.height === height) return prev;
        return { ...prev, [id]: { x, y, width, height } };
      });
    },
    [],
  );
  const target = boxes[selected];
  const ready = target != null;
  const tx = target?.x ?? 0;
  const ty = target?.y ?? 0;
  const tw = target?.width ?? 0;
  const th = target?.height ?? 0;
  const x = useDerivedValue(() => (reduceMotion ? tx : withSpring(tx, MOTION.spring.pill)), [tx, reduceMotion]);
  const w = useDerivedValue(() => (reduceMotion ? tw : withSpring(tw, MOTION.spring.pill)), [tw, reduceMotion]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value, top: ty, height: th, opacity: ready ? 1 : 0 }));
  return { onLayoutFor, pillStyle, ready };
}

export function SelectionPill({ style }: { style: ReturnType<typeof useSelectionPill>["pillStyle"] }) {
  useThemedStyles(publish_styles);
  return <Animated.View pointerEvents="none" style={[styles.pill, style]} />;
}

function make_styles() {
  return StyleSheet.create({
    pill: { position: "absolute", left: 0, borderRadius: 999, backgroundColor: themeColor().pitch },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
