import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { adminFetch } from "@/lib/adminApi";

const LIME = "#a3e635";
const TIERS = [
  { label: "Tier 1", rank: 1 },
  { label: "Tier 2", rank: 2 },
  { label: "Tier 3", rank: 3 },
  { label: "Tier 4", rank: 4 },
  { label: "Tier 5", rank: 5 },
];

type Member = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  instagram: string | null;
  tier: string | null;
  tier_rank: number | null;
  approved: boolean;
  created_at: string;
  playing_position: string | null;
  zip_code: string | null;
};

export default function AdminMembersScreen() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await adminFetch<{ members: Member[] }>("/api/admin/members", token, { method: "GET" });
      if (!r.ok) { setError(r.error || "Failed to load"); return; }
      setMembers(r.data.members || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  async function setTier(userId: string, tier_rank: number, tierLabel: string) {
    const token = session?.access_token;
    if (!token) return;
    setBusy(`tier:${userId}`);
    try {
      const r = await adminFetch<{ ok: boolean }>("/api/admin/members", token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, tier_rank, tier: tierLabel }),
      });
      if (!r.ok) { Alert.alert("Error", r.error || "Failed"); return; }
      setMembers((prev) => prev.map((m) => m.id === userId ? { ...m, tier_rank, tier: tierLabel } : m));
    } finally {
      setBusy(null);
    }
  }

  async function toggleApproved(userId: string, current: boolean) {
    const token = session?.access_token;
    if (!token) return;
    setBusy(`approve:${userId}`);
    try {
      const r = await adminFetch<{ ok: boolean }>("/api/admin/members", token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, approved: !current }),
      });
      if (!r.ok) { Alert.alert("Error", r.error || "Failed"); return; }
      setMembers((prev) => prev.map((m) => m.id === userId ? { ...m, approved: !current } : m));
    } finally {
      setBusy(null);
    }
  }

  const renderItem = ({ item }: { item: Member }) => {
    const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || item.id;
    const joined = new Date(item.created_at).toLocaleDateString();
    const isBusy = busy?.endsWith(item.id);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.sub}>
              {item.username ? `@${item.username}` : ""}{item.instagram ? ` · ig: ${item.instagram}` : ""}
            </Text>
            <Text style={styles.sub}>
              {item.playing_position || "No position"} · {item.zip_code || "No zip"} · Joined {joined}
            </Text>        </View>
          <Pressable
            onPress={() => void toggleApproved(item.id, item.approved)}
            disabled={isBusy}
            style={[styles.approveBtn, item.approved && styles.approveBtnActive]}
          >
            <Text style={[styles.approveBtnText, item.approved && styles.approveBtnTextActive]}>
              {busy === `approve:${item.id}` ? "…" : item.approved ? "Approved" : "Approve"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.tierRow}>
          <Text style={styles.tierLabel}>Tier:</Text>
          {TIERS.map((t) => (
            <Pressable
              key={t.rank}
              onPress={() => void setTier(item.id, t.rank, t.label)}
              disabled={isBusy}
              style={[styles.tierChip, item.tier_rank === t.rank && styles.tierChipActive]}
            >
              <Text style={[styles.tierChipText, item.tier_rank === t.rank && styles.tierChipTextActive]}>
                {busy === `tier:${item.id}` && item.er_rank === t.rank ? "…" : t.rank}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Members</Text>
      {loading ? <ActivityIndicator color={LIME} style={{ marginTop: 32 }} /> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        ListEmptyComponent={!loading ? <Text style={styles.muted}>No members found.</Text> : null}
        onRefresh={load}
        refreshing={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", paddingHorizontal: 16, paddingVertical: 12 },
  card: { backgroundColor: "#111", borderRadius: 14, padding: 14, margiottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  name: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 },
  approveBtn: { borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 5 },
  approveBtnActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.1)" },
  approveBtnText: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },
  approveBtnTextActive: { color: LIME },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierLabel: { color: "rgba(255,255,255,0.45)", fontSize: 12 },
  tierChip: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  tierChipActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.15)" },
  tierChipText: { color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: "700" },
  tierChipTextActive: { color: LIME },
  err: { color: "#f87171", padding: 16 },
  muted: { color: "rgba(255,255,255,0.35)", fontSize: 13 },
});
