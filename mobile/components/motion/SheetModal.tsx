import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { MOTION } from "@/lib/motion";
import { themeColor, useThemedStyles } from "@/theme";

/**
 * The bottom sheet shell every sheet shares: a fading scrim and the sheet sliding up on the one shared spring
 * (MOTION.spring.sheet). Under Reduce Motion the sheet fades in instead. Children are the sheet surface itself.
 */
export function SheetModal({
  visible,
  onClose,
  children,
  closeLabel = "Close",
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
}) {
  useThemedStyles(publish_styles);
  const reduceMotion = useReduceMotion();
  const { damping, stiffness, mass } = MOTION.spring.sheet;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={closeLabel} />
        <Animated.View entering={reduceMotion ? FadeIn.duration(MOTION.duration.fast) : SlideInDown.springify().damping(damping).stiffness(stiffness).mass(mass)}>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end", backgroundColor: themeColor().scrim },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
