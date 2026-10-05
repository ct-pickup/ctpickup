import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { MUTE_CHOICES, muteStatusText, type MuteChoice } from "@/lib/chatMute";
import { radius, themeColor, useThemedStyles } from "@/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** True while the chat is muted; `mutedUntil` null then means until turned off. */
  muted: boolean;
  mutedUntil: string | null;
  busy: boolean;
  /** A short failure message to show, or null. */
  error: string | null;
  onMute: (choice: MuteChoice) => void;
  onUnmute: () => void;
};

/** Bottom sheet behind the bell in a chat header: mute for a while, or turn the mute off. */
export default function MuteSheet({ visible, onClose, muted, mutedUntil, busy, error, onMute, onUnmute }: Props) {
  useThemedStyles(publish_styles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Notifications</Text>
          {muted ? (
            <>
              <Text style={styles.status}>{muteStatusText(mutedUntil)}</Text>
              <Pressable
                onPress={onUnmute}
                disabled={busy}
                style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.primaryText}>Unmute</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.status}>You will not get a push for new messages. They still show in the app.</Text>
              {MUTE_CHOICES.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => onMute(c.id)}
                  disabled={busy}
                  style={({ pressed }) => [styles.row, busy && styles.disabled, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <FontAwesome name="bell-slash-o" size={16} color={themeColor().text} style={styles.icon} />
                  <Text style={styles.rowText}>{c.label}</Text>
                </Pressable>
              ))}
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.overlayStrong },
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 8 },
    handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 999, backgroundColor: c.line, marginBottom: 8 },
    title: { color: c.text, fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700" },
    status: { color: c.muted, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, minHeight: 48, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    icon: { width: 22, textAlign: "center" },
    rowText: { color: c.text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    primary: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 14, alignItems: "center" },
    primaryText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    error: { color: c.muted, fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
