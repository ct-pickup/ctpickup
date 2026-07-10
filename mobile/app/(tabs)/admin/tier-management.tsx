import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

const LIME = "#a3e635";

const TIER_COLORS: Record<string, string> = {
  bronze: "#B87333", silver: "#A8B0B5", gold: "#E3B23C",
  platinum: "#E8E8E8", diamond: "#9B59B6",
};

const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"];
const VERIF_LEVELS = ["self", "document", "vouched"];

type Player = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  verification_level: string | null;
  rating?: { tier: string; score: number; verification: string } | null;
};

export default function AdminTierManagementScreen() {
  const { supabase, session } = useAuth();
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function searchPlayers(q: string) {
    setSearch(q);
    if (q.trim().length < 2 || !supabase) return;
    setSearching(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id,first_name,last_name,username,verification_level")
        .or(`username.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .limit(15);

      if (data && data.length > 0) {
        const ids = data.map((p: any) => p.id);
        const { data: ratings } = await supabase
          .from("player_ratings")
          .select("user_id,tier,score,verification")
          .in("user_id", ids);

        const ratingMap = Object.fromEntries((ratings ?? []).map((r: any) => [r.user_id, r]));
        setPlayers(data.map((p: any) => ({ ...p, rating: ratingMap[p.id] ?? null })));
      } else {
        setPlayers([]);
      }
    } finally {
      setSearching(false);
    }
  }

  async function setTier(player: Player, tier: string) {
    if (busyId) return;
    setBusyId(player.id);
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) { setBusyId(null); return; }
    try {
      const r = await fetch(`${origin}/api/admin/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: player.id, tier }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Failed"); return; }
      await searchPlayers(search);
    } finally {
      setBusyId(null);
    }
  }

  async function setVerification(player: Player, verification: string) {
    if (busyId) return;
    setBusyId(player.id);
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin || !token) { setBusyId(null); return; }
    try {
      const r = await fetch(`${origin}/api/admin/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: player.id, verification }),
      });
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) { Alert.alert("Error", j?.error ?? "Failed"); return; }
      await searchPlayers(search);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Tier Management</Text>

      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={(t) => void searchPlayers(t)}
          placeholder="Search by name or username…"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator color={LIME} style={{ marginLeft: 10 }} />}
      </View>

      {players.map((player) => {
        const name = [player.first_name, player.last_name].filter(Boolean).join(" ") || player.username || "Player";
        const currentTier = player.rating?.tier ?? "unrated";
        const currentVerif = player.rating?.verification ?? player.verification_level ?? "self";
        const busy = busyId === player.id;

        return (
          <View key={player.id} style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{name[0]?.toUpperCase() ?? "?"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{name}</Text>
                {player.username && <Text style={s.meta}>@{player.username}</Text>}
                <Text style={s.meta}>
                  Score: {player.rating?.score?.toFixed(1) ?? "—"} · {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
                </Text>
              </View>
              {busy && <ActivityIndicator color={LIME} />}
            </View>

            <Text style={s.sectionLabel}>SET TIER</Text>
            <View style={s.chipRow}>
              {TIERS.map((t) => (
                <Pressable key={t} onPress={() => void setTier(player, t)} disabled={!!busy}
                  style={[s.chip, currentTier === t && { borderColor: TIER_COLORS[t], backgroundColor: `${TIER_COLORS[t]}22` }]}>
                  <Text style={[s.chipText, currentTier === t && { color: TIER_COLORS[t] }]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.sectionLabel, { marginTop: 12 }]}>SET VERIFICATION</Text>
            <View style={s.chipRow}>
              {VERIF_LEVELS.map((v) => (
                <Pressable key={v} onPress={() => void setVerification(player, v)} disabled={!!busy}
                  style={[s.chip, currentVerif === v && { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.1)" }]}>
                  <Text style={[s.chipText, currentVerif === v && { color: LIME }]}>
                    {v === "self" ? "Self" : v === "document" ? "✓ Document" : "✓ Vouched"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}

      {search.length >= 2 && !searching && players.length === 0 && (
        <Text style={s.empty}>No players found.</Text>
      )}
      {search.length < 2 && (
        <Text style={s.empty}>Type at least 2 characters to search players.</Text>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", padding: 16 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 16, marginTop: 8 },
  searchRow: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  card: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(163,230,53,0.15)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: LIME, fontWeight: "700", fontSize: 16 },
  name: { color: "#fff", fontSize: 16, fontWeight: "700" },
  meta: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  sectionLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.04)" },
  chipText: { color: "rgba(255,255,255,0.55)", fontWeight: "600", fontSize: 13 },
  empty: { color: "rgba(255,255,255,0.35)", fontSize: 14, textAlign: "center", marginTop: 20 },
});
