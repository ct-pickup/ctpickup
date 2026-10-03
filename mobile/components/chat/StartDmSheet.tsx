import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { findAdminDmRoom, startAdminDm } from "@/lib/adminDm";
import { radius, themeColor, useThemedStyles } from "@/theme";

export type DmTarget = { userId: string; name: string };

/**
 * Opens the 1:1 thread with `target`, or, when there is none yet, asks for a first message and creates it.
 * Call `open()` from a button. Admins only: the server rejects everyone else.
 */
export function useStartDm() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [target, setTarget] = useState<DmTarget | null>(null);
  const [checking, setChecking] = useState(false);

  const openThread = (roomId: string) =>
    router.push({ pathname: "/(tabs)/messages/thread", params: { id: roomId } });

  const open = async (t: DmTarget) => {
    if (!token || checking) return;
    setChecking(true);
    const found = await findAdminDmRoom(token, t.userId);
    setChecking(false);
    if (found.ok && found.roomId) openThread(found.roomId);
    else setTarget(t);
  };

  const sheet = (
    <FirstMessageSheet
      target={target}
      token={token}
      onClose={() => setTarget(null)}
      onSent={(roomId) => {
        setTarget(null);
        openThread(roomId);
      }}
    />
  );
  return { open, checking, sheet };
}

function FirstMessageSheet({
  target,
  token,
  onClose,
  onSent,
}: {
  target: DmTarget | null;
  token: string | null;
  onClose: () => void;
  onSent: (roomId: string) => void;
}) {
  useThemedStyles(publish_styles);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!target || !token || busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    const res = await startAdminDm(token, target.userId, text.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setText("");
    onSent(res.roomId);
  }

  return (
    <Modal visible={target != null} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kav}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Message {target?.name}</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Type your first message…"
              placeholderTextColor={themeColor().muted}
              multiline
              autoFocus
              editable={!busy}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable onPress={onClose} disabled={busy} style={[styles.btn, styles.ghost]} accessibilityRole="button">
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void send()}
                disabled={busy || !text.trim()}
                style={[styles.btn, styles.primary, (busy || !text.trim()) && styles.dim]}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={styles.primaryText}>Send</Text>}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "center", alignItems: "center", padding: 20 },
    kav: { width: "100%" },
    card: { backgroundColor: c.bg, borderRadius: radius.card, padding: 16, gap: 12 },
    title: { color: c.text, fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700" },
    input: {
      minHeight: 80,
      maxHeight: 160,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
      padding: 12,
      color: c.text,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      textAlignVertical: "top",
    },
    error: { color: c.coralText, fontSize: 13, fontFamily: "Inter_500Medium" },
    actions: { flexDirection: "row", gap: 8 },
    btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
    ghost: { borderWidth: 1, borderColor: c.line },
    ghostText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    primary: { backgroundColor: c.pitch },
    primaryText: { color: c.onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    dim: { opacity: 0.5 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
