import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";

import { radius, themeColor, useThemedStyles } from "@/theme";

type Props = {
  /** Heights available to the sheet's top edge: where it sits when fully open, half open and tucked away (px from the top of its container). */
  snaps: [number, number, number];
  /** Which snap it opens at (0 open, 1 half, 2 tucked). */
  initial?: 0 | 1 | 2;
  /** Pinned above the scrolling content: the drag handle sits over it. */
  header: ReactNode;
  children: ReactNode;
};

/**
 * A bottom sheet the player drags up and down by its handle and header. It snaps to open, half and tucked positions, so the
 * map above it and the list inside it are both always on screen. Drag lives on the handle only, so the list scrolls normally.
 */
export function FieldSheet({ snaps, initial = 1, header, children }: Props) {
  useThemedStyles(publish_styles);
  const [top] = useState(() => new Animated.Value(snaps[initial]));
  const snapsRef = useRef(snaps);
  const current = useRef(snaps[initial]);
  const startTop = useRef(snaps[initial]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    snapsRef.current = snaps;
    // Container resized (rotation, keyboard): keep the sheet on the nearest snap.
    if (mounted) {
      const near = snaps.reduce((a, b) => (Math.abs(b - current.current) < Math.abs(a - current.current) ? b : a));
      current.current = near;
      top.setValue(near);
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-snap only when the snap positions change
  }, [snaps[0], snaps[1], snaps[2]]);

  useEffect(() => {
    const id = top.addListener(({ value }) => {
      current.current = value;
    });
    return () => top.removeListener(id);
  }, [top]);

  function settle(to: number) {
    Animated.spring(top, { toValue: to, useNativeDriver: false, bounciness: 0, speed: 16 }).start();
  }

  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        top.stopAnimation((v) => {
          startTop.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const [open, , tucked] = snapsRef.current;
        top.setValue(Math.min(tucked, Math.max(open, startTop.current + g.dy)));
      },
      onPanResponderRelease: (_, g) => {
        const s = snapsRef.current;
        if (Math.abs(g.dy) < 4) {
          // A tap steps through the snaps.
          const i = s.findIndex((v) => Math.abs(v - current.current) < 2);
          settle(s[(i + 1) % s.length]!);
          return;
        }
        // Throw: project where the sheet would land, then take the nearest snap.
        const projected = current.current + g.vy * 120;
        settle(s.reduce((a, b) => (Math.abs(b - projected) < Math.abs(a - projected) ? b : a)));
      },
    }),
  );

  return (
    <Animated.View style={[styles.sheet, { top }]}>
      <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Fields list. Drag up or down to resize." style={styles.dragZone}>
        <View style={styles.handle} />
        {header}
      </View>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: c.line,
      overflow: "hidden",
    },
    dragZone: { paddingHorizontal: 20, paddingBottom: 8, backgroundColor: c.bg },
    handle: { alignSelf: "center", width: 40, height: 5, borderRadius: radius.pill, backgroundColor: c.line, marginVertical: 8 },
    body: { flex: 1 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
