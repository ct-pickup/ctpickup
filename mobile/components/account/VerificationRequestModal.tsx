import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useState } from "react";
import { themeColor } from "@/theme";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmitted: () => void;
};

export function VerificationRequestModal({ visible, onClose, onSubmitted }: Props) {
  const { session } = useAuth();
  const [claim, setClaim] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!claim.trim()) { Alert.alert("Missing info", "Please describe your playing background."); return; }
    if (!evidenceUrl.trim()) { Alert.alert("Missing info", "Please provide a roster URL or link to evidence."); return; }

    const token = session?.access_token;
    const origin = siteOrigin();
    if (!token || !origin) return;

    setBusy(true);
    try {
      const r = await fetch(`${origin}/api/account/verification-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ claim: claim.trim(), evidence_url: evidenceUrl.trim() }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        Alert.alert("Error", j?.error ?? "Could not submit request.");
        return;
      }
      Alert.alert("Submitted!", "We'll review your verification request within 24 hours.");
      setClaim("");
      setEvidenceUrl("");
      onSubmitted();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={s.header}>
            <Text style={s.title}>Get verified</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={s.close}>✕</Text>
            </Pressable>
          </View>

          <View style={s.tierCard}>
            <Text style={s.tierTitle}>What verification unlocks</Text>
            <View style={s.tierRow}>
              <Text style={s.tierBadge}>Document</Text>
              <Text style={s.tierDesc}>Unlocks Platinum + Diamond tiers</Text>
            </View>
            <View style={s.tierRow}>
              <Text style={s.tierBadge}>Vouched</Text>
              <Text style={s.tierDesc}>Two Diamond players confirm you — no docs needed</Text>
            </View>
            <Text style={s.tierHint}>Self-declared players are capped at Gold tier.</Text>
          </View>

          <Text style={s.label}>YOUR CLAIM</Text>
          <TextInput
            style={s.input}
            value={claim}
            onChangeText={setClaim}
            placeholder="e.g. Played USL League Two 2023, Stamford FC. College varsity at UConn 2021–2024."
            placeholderTextColor={themeColor().muted}
            multiline
            numberOfLines={4}
            autoCorrect={false}
          />
          <Text style={s.hint}>Describe your highest level of play, teams, and years.</Text>

          <Text style={[s.label, { marginTop: 20 }]}>ROSTER / EVIDENCE URL</Text>
          <TextInput
            style={s.input}
            value={evidenceUrl}
            onChangeText={setEvidenceUrl}
            placeholder="https://topdrawersoccer.com/..."
            placeholderTextColor={themeColor().muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={s.hint}>
            Link to your roster page, athletics bio, team website, or MaxPreps profile.{" "}
            <Text style={{ color: themeColor().pitchText }} onPress={() => void Linking.openURL("https://topdrawersoccer.com").catch(() => {})}>
              TopDrawer ↗
            </Text>
            {"  "}
            <Text style={{ color: themeColor().pitchText }} onPress={() => void Linking.openURL("https://www.maxpreps.com").catch(() => {})}>
              MaxPreps ↗
            </Text>
          </Text>

          <Pressable onPress={() => void submit()} disabled={busy}
            style={[s.btn, busy && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color={themeColor().onPitch} /> : <Text style={s.btnText}>Submit for verification</Text>}
          </Pressable>

          <Text style={s.footer}>
            We review requests manually within 24 hours. You'll be notified when your status updates.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, padding: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 24 },
  title: { color: themeColor().text, fontSize: 24, fontFamily: "InstrumentSerif_400Regular", fontWeight: "800" },
  close: { color: themeColor().muted, fontSize: 20, fontFamily: "InstrumentSerif_400Regular" },
  tierCard: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 16, marginBottom: 24 },
  tierTitle: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginBottom: 12 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  tierBadge: { color: themeColor().pitchText, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold", borderWidth: 1, borderColor: themeColor().pitch, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  tierDesc: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  tierHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  label: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "800", color: themeColor().text, marginBottom: 10, },
  input: { backgroundColor: themeColor().overlay, borderRadius: 10, borderWidth: 1.5, borderColor: themeColor().line, color: themeColor().text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", minHeight: 80, textAlignVertical: "top" },
  hint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 19 },
  btn: { backgroundColor: themeColor().pitch, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 28 },
  btnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  footer: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 16, lineHeight: 18 },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

