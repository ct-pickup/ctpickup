import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
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

const LIME = "#a3e635";

type VerificationRequest = {
  id: string;
  user_id: string;
  claim: string;
  evidence_url: string;
  status: string;
  created_at: string;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    verification_level: string | null;
  } | null;
};

export default function AdminVerificationScreen() {
  const { supabase } = useAuth();
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("verification_requests")
        .select("id,user_id,claim,evidence_url,status,created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        const userIds = [...new Set(data.map((r: any) => r.user_id))];
        const { data: profileData } = await supabase
          .from("profiles")
          .select("id,first_name,last_name,username,verification_level")
          .in("id", userIds);

        const profileMap = Object.fromEntries((profileData ?? []).map((p: any) => [p.id, p]));
        const merged = data.map((r: any) => ({ ...r, profiles: profileMap[r.user_id] ?? null }));
        setRequests(merged as VerificationRequest[]);
      } else {
        setRequests([]);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function review(req: VerificationRequest, decision: "approved" | "rejected") {
    if (busyId || !supabase) return;
    setBusyId(req.id);
    try {
      // Update verification_requests
      const { error } = await supabase
        .from("verification_requests")
        .update({ status: decision, reviewed_at: new Date().toISOString() })
        .eq("id", req.id);

      if (error) { Alert.alert("Error", error.message); return; }

      if (decision === "approved") {
        // Update profiles.verification_level
        await supabase
          .from("profiles")
          .update({ verification_level: "document" })
          .eq("id", req.user_id);

        // Update player_ratings.verification if row exists
        await supabase
          .from("player_ratings")
          .update({ verification: "document", updated_at: new Date().toISOString() })
          .eq("user_id", req.user_id);
      }

      await load();
      Alert.alert(decision === "approved" ? "Approved ✓" : "Rejected", `${req.profiles?.first_name ?? "Player"} has been ${decision}.`);
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={LIME} size="large" /></View>;
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.pageTitle}>Verification Requests</Text>

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
              <View style={[s.statusPill, { borderColor: "#facc15" }]}>
                <Text style={[s.statusText, { color: "#facc15" }]}>Pending</Text>
              </View>
            </View>

            <Text style={s.claimLabel}>CLAIM</Text>
            <Text style={s.claimText}>{req.claim}</Text>

            <Pressable onPress={() => Linking.openURL(req.evidence_url)} style={s.urlRow}>
              <Text style={s.urlText} numberOfLines={1}>🔗 {req.evidence_url}</Text>
            </Pressable>

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
                onPress={() => Alert.alert("Approve?", `Grant ${name} Document Verified status?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Approve", onPress: () => void review(req, "approved") },
                ])}
                disabled={!!busy}
                style={[s.approveBtn, busy && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color="#0a0a0a" size="small" /> :
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
                  <View style={[s.statusPill, { borderColor: approved ? LIME : "#ef4444" }]}>
                    <Text style={[s.statusText, { color: approved ? LIME : "#ef4444" }]}>
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 16 },
  center: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  pageTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 20, marginTop: 8 },
  emptyCard: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 20, alignItems: "center" },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 14 },
  card: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(163,230,53,0.15)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: LIME, fontWeight: "700", fontSize: 16 },
  name: { color: "#fff", fontSize: 16, fontWeight: "700" },
  meta: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: "700" },
  claimLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 6 },
  claimText: { color: "rgba(255,255,255,0.8)", fontSize: 14, lineHeight: 20, marginBottom: 12 },
  urlRow: { backgroundColor: "rgba(163,230,53,0.06)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(163,230,53,0.2)", padding: 10, marginBottom: 14 },
  urlText: { color: LIME, fontSize: 13 },
  actions: { flexDirection: "row", gap: 10 },
  rejectBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "#ef4444", alignItems: "center" },
  rejectBtnText: { color: "#ef4444", fontWeight: "700", fontSize: 14 },
  approveBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: LIME, alignItems: "center" },
  approveBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 14 },
  sectionTitle: { color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginTop: 24, marginBottom: 12 },
});
