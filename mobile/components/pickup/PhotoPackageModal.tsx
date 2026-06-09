import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

const LIME = "#a3e635";

type Props = {
  visible: boolean;
  runName: string | null;
  feeCents: number;
  onConfirm: (photoPackage: boolean) => void;
};

export function PhotoPackageModal({ visible, runName, feeCents, onConfirm }: Props) {
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
              <Text style={styles.rowTitle}>📸 Action Photos  +$5</Text>
              <Text style={styles.rowSub}>
                Get at least 5 action shots sent to your DM/email within 24hrs of the run
              </Text>
            </View>
            <Switch
              value={photoPackage}
              onValueChange={setPhotoPackage}
              trackColor={{ false: "rgba(255,255,255,0.15)", true: LIME }}
              thumbColor={Platform.OS === "android" ? (photoPackage ? "#111" : "#fff") : undefined}
              ios_backgroundColor="rgba(255,255,255,0.15)"
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  card: {
    backgroundColor: "#141414",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  runName: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
  feeLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
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
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  rowSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 18,
  },
  confirmBtn: {
    marginTop: 8,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  confirmBtnText: {
    color: "#111",
    fontSize: 16,
    fontWeight: "800",
  },
});
