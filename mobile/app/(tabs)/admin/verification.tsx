import { InstagramVerificationQueue } from "@/components/admin/InstagramVerificationQueue";
import { StarLevelSelect } from "@/components/StarLevels";
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { starLevelLabel } from "@shared/starLevels";

type VerificationRequest = {
  id: string;
  user_id: string;
  claim: string;
  evidence_url: string;
  status: string;
  created_at: string;
  claimed_level: number | null;
  stated_level: number | null;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    username: string | null;
  } | null;
};

type ApiItem = Omit<VerificationRequest, "profiles"> & {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
};

export default function AdminVerificationScreen() {
  useThemedStyles(publish_s);

  const { session } = useAuth();
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) return;
    setLoading(true);
    try {
      const fetchStatus = async (status: string): Promise<ApiItem[]> => {
        const r = await fetch(`${origin}/api/admin/verification?status=${status}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = (await r.json().catch(() => null)) as { items?: ApiItem[] } | null;
        return r.ok ? (j?.items ?? []) : [];
      };
      const lists = await Promise.all(["pending", "approved", "rejected"].map(fetchStatus));
      setRequests(
        lists.flat().map((i) => ({
          ...i,
          profiles: { first_name: i.first_name, last_name: i.last_name, username: i.username },
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function review(req: VerificationRequest, decision: "approved" | "rejected") {
    if (busyId) return;
    setBusyId(req.id);
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) { setBusyId(null); return; }
    try {
      const r = await fetch(`${origin}/api/admin/verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          request_id: req.id,
          decision,
          level: decision === "approved" ? levelFor(req) : undefined,
        }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Failed."); return; }
      await load();
      Alert.alert(decision === "approved" ? "Approved ✓" : "Rejected", `${req.profiles?.first_name ?? "Player"} has been ${decision}.`);
    } finally {
      setBusyId(null);
    }
  }

  function levelFor(req: VerificationRequest): number | null {
    return levels[req.id] ?? req.claimed_level ?? req.stated_level ?? null;
  }

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={themeColor().pitchText} size="large" /></View>;
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.pageTitle}>Verification Requests</Text>

      <InstagramVerificationQueue />

      <Text style={s.sectionTitle}>Documents</Text>

      {pending.length === 0 && (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>No pending requests.</Text>
        </View>
      )}

      {pending.map((req) => {
        const name = [req.profiles?.first_name, req.profiles?.last_name].filter(Boolean).join(" ") || req.profiles?.username || "Unknown";
        const busy = busyId === req.id;
        return (
          <View key={req.id} style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{name}</Text>
                <Text style={s.meta}>@{req.profiles?.username ?? "—"} · {new Date(req.created_at).toLocaleDateString()}</Text>
              </View>
              <View style={[s.statusPill, { borderColor: themeColor().line, backgroundColor: themeColor().card }]}>
                <Text style={[s.statusText, { color: themeColor().muted }]}>Pending</Text>
              </View>
            </View>

            <Text style={s.claimLabel}>CLAIM</Text>
            <Text style={s.claimText}>{req.claim}</Text>

            <Pressable onPress={() => Linking.openURL(req.evidence_url)} style={s.urlRow}>
              <Text style={s.urlText} numberOfLines={1}>🔗 {req.evidence_url}</Text>
            </Pressable>

            <Text style={s.claimLabel}>Verified level</Text>
            <StarLevelSelect
              value={levelFor(req)}
              onChange={(star) => setLevels((prev) => ({ ...prev, [req.id]: star }))}
              title="Verified level"
              placeholder="Pick the verified level"
              style={s.levelSelect}
            />

            <View style={s.actions}>
              <Pressable
                onPress={() => Alert.alert("Reject?", `Reject ${name}'s verification request?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Reject", style: "destructive", onPress: () => void review(req, "rejected") },
                ])}
                disabled={!!busy}
                style={[s.rejectBtn, busy && { opacity: 0.5 }]}
              >
                <Text style={s.rejectBtnText}>Reject</Text>
              </Pressable>
              <Pressable
                onPress={() => levelFor(req) == null
                  ? Alert.alert("Pick a level", "Choose the verified level before approving.")
                  : Alert.alert("Approve?", `Verify ${name} at ${starLevelLabel(levelFor(req))}?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Approve", onPress: () => void review(req, "approved") },
                ])}
                disabled={!!busy}
                style={[s.approveBtn, busy && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color={themeColor().onPitch} size="small" /> :
                  <Text style={s.approveBtnText}>Approve ✓</Text>}
              </Pressable>
            </View>
          </View>
        );
      })}

      {reviewed.length > 0 && (
        <>
          <Text style={s.sectionTitle}>REVIEWED</Text>
          {reviewed.map((req) => {
            const name = [req.profiles?.first_name, req.profiles?.last_name].filter(Boolean).join(" ") || req.profiles?.username || "Unknown";
            const approved = req.status === "approved";
            return (
              <View key={req.id} style={[s.card, { opacity: 0.6 }]}>
                <View style={s.cardHeader}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{name}</Text>
                    <Text style={s.meta}>{new Date(req.created_at).toLocaleDateString()}</Text>
                  </View>
                  <View style={[s.statusPill, { borderColor: approved ? themeColor().pitch : themeColor().coral }]}>
                    <Text style={[s.statusText, { color: approved ? themeColor().onPitchPanel : themeColor().coralText }]}>
                      {approved ? "Approved" : "Rejected"}
                    </Text>
                  </View>
                </View>
                <Text style={s.claimText} numberOfLines={2}>{req.claim}</Text>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
  center: { flex: 1, backgroundColor: themeColor().bg, alignItems: "center", justifyContent: "center" },
  pageTitle: { color: themeColor().text, fontSize: 24, ...headline, marginBottom: 20, marginTop: 8 },
  emptyCard: { backgroundColor: themeColor().card, borderRadius: 12, padding: 20, alignItems: "center" },
  emptyText: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: 999, backgroundColor: themeColor().pitchPanel, alignItems: "center", justifyContent: "center" },
  avatarText: { color: themeColor().onPitchPanel, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  meta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700" },
  claimLabel: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().muted, marginBottom: 4 },
  claimText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  urlRow: { backgroundColor: themeColor().pitchPanel, borderRadius: 10, borderWidth: 1, borderColor: themeColor().pitch, padding: 8, marginBottom: 12 },
  urlText: { color: themeColor().pitchText, fontSize: 13, fontFamily: "Inter_400Regular" },
  levelSelect: { marginBottom: 12 },
  actions: { flexDirection: "row", gap: 8 },
  rejectBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: themeColor().coral, alignItems: "center" },
  rejectBtnText: { color: themeColor().coralText, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  approveBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: themeColor().pitch, alignItems: "center" },
  approveBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold" },
  sectionTitle: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 24, marginBottom: 12 },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

