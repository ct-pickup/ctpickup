import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";
type Props = {
  visible: boolean;
  runName: string | null;
  feeCents: number;
  onConfirm: (photoPackage: boolean) => void;
};

export function PhotoPackageModal({ visible, runName, feeCents, onConfirm }: Props) {
  useThemedStyles(publish_styles);

  const [photoPackage, setPhotoPackage] = useState(false);

  // Reset toggle each time modal opens
  useEffect(() => {
    if (visible) setPhotoPackage(false);
  }, [visible]);

  const baseFeeLabel = feeCents > 0 ? `$${(feeCents / 100).toFixed(2)}` : "Free";
  const totalLabel =
    photoPackage
      ? `$${((feeCents + 500) / 100).toFixed(2)}`
      : baseFeeLabel;

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {runName ? <Text style={styles.runName} numberOfLines={2}>{runName}</Text> : null}
          <Text style={styles.feeLabel}>Field fee: {baseFeeLabel}</Text>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowTexts}>
              <Text style={styles.rowTitle}>Action Photos  +$5</Text>
              <Text style={styles.rowSub}>
                Get at least 5 action shots sent to your DM/email within 24hrs of the run
              </Text>
            </View>
            <Switch
              value={photoPackage}
              onValueChange={setPhotoPackage}
              trackColor={{ false: themeColor().overlay, true: themeColor().pitch }}
              thumbColor={Platform.OS === "android" ? (photoPackage ? themeColor().bg : themeColor().text) : undefined}
              ios_backgroundColor={themeColor().overlay}
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.88 }]}
            onPress={() => onConfirm(photoPackage)}
          >
            <Text style={styles.confirmBtnText}>
              Proceed to Checkout
              {feeCents > 0 || photoPackage ? ` (${totalLabel})` : ""}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function make_styles() {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: themeColor().scrim,
  },
  card: {
    backgroundColor: themeColor().card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: themeColor().line,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  runName: {
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
  },
  feeLabel: {
    color: themeColor().muted,
    fontSize: 14, fontFamily: "Inter_400Regular",
  },
  divider: {
    height: 1,
    backgroundColor: themeColor().overlay,
    marginVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTexts: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: themeColor().text,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  rowSub: {
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  confirmBtn: {
    marginTop: 8,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  confirmBtnText: {
    color: themeColor().onPitch,
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

