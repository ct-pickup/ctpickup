import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";

const LIME = "#a3e635";
const TIERS = [1, 2, 3, 4, 5];

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
  is_banned: boolean;
  ban_reason: string | null;
  wins_override: number | null;
  losses_override: number | null;
  player_of_day_override: number | null;
  defender_of_day_override: number | null;
  midfielder_of_day_override: number | null;
  attacker_of_day_override: number | null;
};

export default function AdminMembersScreen() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editStats, setEditStats] = useState<Record<string, string>>({});
  const [banReason, setBanReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${siteOrigin()}/api/admin/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Failed to load"); return; }
      setMembers(j.members || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  async function patch(userId: string, update: Record<string, unknown>) {
    const token = session?.access_token;
    if (!token) return false;
    const res = await fetch(`${siteOrigin()}/api/admin/members`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, ...update }),
    });
    const j = await res.json();
    if (!res.ok) { Alert.alert("Error", j.error || "Failed"); return false; }
    return true;
  }

  async function setTier(userId: string, tier_rank: number) {
    setBusy("tier:" + userId);
    const ok = await patch(userId, { tier_rank, tier: "Tier " + tier_rank });
    if (ok) setMembers((p) => p.map((m) => m.id === userId ? { ...m, tier_rank, tier: "Tier " + tier_rank } : m));
    setBusy(null);
  }

  async function toggleApproved(userId: string, current: boolean) {
    setBusy("approve:" + userId);
    const ok = await patch(userId, { approved: !current });
    if (ok) setMembers((p) => p.map((m) => m.id === userId ? { ...m, approved: !current } : m));
    setBusy(null);
  }

  async function saveStats(userId: string) {
    setBusy("stats:" + userId);
    const s = editStats[userId] ? JSON.parse(editStats[userId]) : {};
    const ok = await patch(userId, s);
    if (ok) {
      setMembers((p) => p.map((m) => m.id === userId ? { ...m, ...s } : m));
      Alert.alert("Saved", "Stats updated.");
    }
    setBusy(null);
  }

  async function banPlayer(userId: string, current: boolean) {
    if (!current) {
      const reason = banReason[userId] || "";
      if (!reason.trim()) { Alert.alert("Required", "Enter a ban reason first."); return; }
      Alert.alert("Ban player?", "They will receive a push notification.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Ban", style: "destructive", onPress: async () => {
            setBusy("ban:" + userId);
            const ok = await patch(userId, { is_banned: true, ban_reason: reason, approved: false });
            if (ok) {
              setMembers((p) => p.map((m) => m.id === userId ? { ...m, is_banned: true, ban_reason: reason, approved: false } : m));
              // Send push
              const token = session?.access_token;
              if (token) {
                await fetch(`${siteOrigin()}/api/admin/members`, {
                  method: "PATCH",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ user_id: userId, send_ban_push: true, ban_reason: reason }),
                });
              }
            }
            setBusy(null);
          }
        }
      ]);
    } else {
      setBusy("ban:" + userId);
      const ok = await patch(userId, { is_banned: false, ban_reason: null, approved: true });
      if (ok) setMembers((p) => p.map((m) => m.id === userId ? { ...m, is_banned: false, ban_reason: null, approved: true } : m));
      setBusy(null);
    }
  }

  async function deleteProfile(userId: string, name: string) {
    Alert.alert("Delete " + name + "?", "This permanently deletes their account. Cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          setBusy("delete:" + userId);
          const token = session?.access_token;
          if (!token) return;
          const res = await fetch(`${siteOrigin()}/api/admin/members`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId }),
          });
          const j = await res.json();
          if (!res.ok) { Alert.alert("Error", j.error || "Failed"); }
          else { setMembers((p) => p.filter((m) => m.id !== userId)); }
          setBusy(null);
        }
      }
    ]);
  }

  const renderItem = ({ item }: { item: Member }) => {
    const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || item.id;
    const joined = new Date(item.created_at).toLocaleDateString();
    const isExpanded = expanded === item.id;
    const isBusy = busy !== null && busy.endsWith(item.id);
    const subLine1 = (item.username ? "@" + item.username : "") + (item.instagram ? (item.username ? " · ig: " : "ig: ") + item.instagram : "");
    const subLine2 = (item.playing_position || "No position") + " · " + (item.zip_code || "No zip") + " · Joined " + joined;

    const statsFields = [
      { key: "wins_override", label: "Wins", val: item.wins_override },
      { key: "losses_override", label: "Losses", val: item.losses_override },
      { key: "player_of_day_override", label: "Player of Day", val: item.player_of_day_override },
      { key: "defender_of_day_override", label: "Defender of Day", val: item.defender_of_day_override },
      { key: "midfielder_of_day_override", label: "Mid of Day", val: item.midfielder_of_day_override },
      { key: "attacker_of_day_override", label: "Attacker of Day", val: item.attacker_of_day_override },
    ];

    return (
      <View style={[styles.card, item.is_banned && styles.cardBanned]}>
        <Pressable onPress={() => setExpanded(ipanded ? null : item.id)}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{name}{item.is_banned ? " 🚫" : ""}</Text>
              {subLine1.length > 0 ? <Text style={styles.sub}>{subLine1}</Text> : null}
              <Text style={styles.sub}>{subLine2}</Text>
            </View>
            <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
          </View>
        </Pressable>

        {isExpanded ? (
          <View style={{ marginTop: 12 }}>
            <View style={styles.tierRow}>
              <Text style={styles.label}>Tier:</Text>
              {TIERS.map((t) => (
                <Pressable key={t} onPress={() => void setTier(item.id, t)} disabled={isBusy}
                  style={[styles.tierChip, item.tier_rank === t && styles.tierChipActive]}>
                  <Text style={[styles.tierChipText, item.tier_rank === t && styles.tierChipTextActive]}>
                    {t}
                  </Text>
          </Pressable>
              ))}
            </View>

            <View style={styles.actionRow}>
              <Pressable onPress={() => void toggleApproved(item.id, item.approved)} disabled={isBusy}
                style={[styles.actionBtn, item.approved && styles.actionBtnActive]}>
                <Text style={[styles.actionBtnText, item.approved && styles.actionBtnTextActive]}>
                  {item.approved ? "Approved ✓" : "Approve"}
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Stats overrides</Text>
            <View style={styles.statsGrid}>
              {statsFields.map((f) => {
                const statsObj = editStats[item.id] ? JSON.parse(editStats[item.id]) : {};
                const val = statsObj[f.key] !== undefined ? String(statsObj[f.key]) : f.val !== null ? String(f.val) : "";
                return (
                  <View key={f.key} style={styles.statField}>
                    <Text style={yles.statLabel}>{f.label}</Text>
                    <TextInput
                      style={styles.statInput}
                      value={val}
                      onChangeText={(v) => {
                        const cur = editStats[item.id] ? JSON.parse(editStats[item.id]) : {};
                        cur[f.key] = v === "" ? null : Number(v);
                        setEditStats((p) => ({ ...p, [item.id]: JSON.stringify(cur) }));
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                    />
                  </View>
                );
              })}
            </View>
            <Pressable onPress={() => void saveStats(item.id)} disabled={isBusy}
              style={[styles.actionBtn, styles.actionBtnActive, { marginTop: 8 }]}>
              <Text style={styles.actionBtnTextActive}>
                {busy === "stats:" + item.id ? "Saving…" : "Save stats"}
            </Text>
            </Pressable>

            <Text style={[styles.label, { marginTop: 14 }]}>Ban reason</Text>
            <TextInput
              style={styles.banInput}
              value={banReason[item.id] || item.ban_reason || ""}
              onChangeText={(v) => setBanReason((p) => ({ ...p, [item.id]: v }))}
              placeholder="Reason for ban..."
              placeholderTextColor="rgba(255,255,255,0.3)"
            />
            <View style={styles.actionRow}>
              <Pressable onPress={() => void banPlayer(item.id, item.is_banned)} disabled={isBusy}
                style={[styles.actionBtn, item.is_banned ? styles.actionBtnActive : styles.actionBtnDanger]}>
                <Text style={[styles.actionBtnText, item.is_banned ? styles.actionBtnTextActive : styles.actionBtnTextDanger]}>
                  {busy === "ban:" + item.id ? "…" : item.is_banned ? "Unban" : "Ban player"}
                </Text>
              </Pressable>
              <Pressable onPress={() => voideleteProfile(item.id, name)} disabled={isBusy}
                style={[styles.actionBtn, styles.actionBtnDanger]}>
                <Text style={styles.actionBtnTextDanger}>
                  {busy === "delete:" + item.id ? "Deleting…" : "Delete account"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
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

const sles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", paddingHorizontal: 16, paddingVertical: 12 },
  card: { backgroundColor: "#111", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  cardBanned: { borderColor: "rgba(239,68,68,0.4)", backgroundColor: "#1a0a0a" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  name: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 },
  chevron: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 6 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  tierChip: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  tierChipActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.15)" },
  tierChipText: { color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: "700" },
  tierChipTextActive: { color: LIME },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn: { borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", paddingHorizontal: 12, paddingVertical: 7, flex: 1, alignItems: "center" },
  actionBtnActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.1)" },
  actionBtnDanger: { borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.1)" },
  actionBtnText: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },
  actionBtnTextActive: { color: LIME, fontSize: 12, fontWeight: "700" },
  actionBtnTextDanger: { color: "#f87171", fontSize: 12, fontWeight: "700" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statField: { width: "30%", minWidth: 90 },
  statLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, marginBottom: 3 },
  statInput: { backgroundColor: "#1a1a1a", borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", color: "#fff", padding: 6, fontSize: 13 },
  banInput: { backgroundColor: "#1a1a1a", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", color: "#fff", padding: 8, fontSize: 13, marginBottom: 8 },
  err: { color: "#f87171", padding: 16 },
  muted: { color: "rgba(255,255,255,0.35)", fontSize: 13 },
});
