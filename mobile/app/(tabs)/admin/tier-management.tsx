import { useAuth } from "@/context/AuthContext";
import { fetchAdminPlayerRatings, type AdminPlayerRating } from "@/lib/adminApi";
import { siteOrigin } from "@/lib/env";
import { formatStars, SKILL_STAR_RANGE } from "@/lib/starRatings";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

function TIER_COLORS(): Record<string, string> {
  return {
  bronze: themeColor().muted, silver: themeColor().muted, gold: themeColor().muted,
  platinum: themeColor().muted, diamond: themeColor().muted,
};
}

const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"];

/** Admin-facing label for a stored tier value: its star range ("3.5–4.0"), never the tier name. */
function tierLabel(tier: string): string {
  const r = SKILL_STAR_RANGE[tier];
  return r ? `${r.low.toFixed(1)}–${r.high.toFixed(1)}` : "Unrated";
}
const VERIF_LEVELS = ["self", "document", "vouched"];

type Player = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  verification_level: string | null;
  rating?: AdminPlayerRating | null;
};

export default function AdminTierManagementScreen() {
  useThemedStyles(publish_s);

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
        const token = session?.access_token;
        const res = token ? await fetchAdminPlayerRatings(token, { userIds: ids }) : null;
        const ratings = res?.ok ? res.data.ratings : [];

        const ratingMap = Object.fromEntries(ratings.map((r) => [r.user_id, r]));
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
      <Text style={s.title}>Player levels</Text>

      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={(t) => void searchPlayers(t)}
          placeholder="Search by name or username…"
          placeholderTextColor={themeColor().muted}
          autoCorrect={false}
        />
        {searching && <ActivityIndicator color={themeColor().pitchText} style={{ marginLeft: 8 }} />}
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
                  Score: {player.rating?.score != null ? Number(player.rating.score).toFixed(1) : "—"} · {tierLabel(currentTier)}
                  {player.rating?.star_rating != null
                    ? ` · ${formatStars(Number(player.rating.star_rating))}${player.rating.star_provisional ? " (provisional)" : ""}`
                    : ""}
                </Text>
              </View>
              {busy && <ActivityIndicator color={themeColor().pitchText} />}
            </View>

            <Text style={s.sectionLabel}>SET LEVEL RANGE</Text>
            <View style={s.chipRow}>
              {TIERS.map((t) => (
                <Pressable key={t} onPress={() => void setTier(player, t)} disabled={!!busy}
                  style={[s.chip, currentTier === t && { borderColor: TIER_COLORS()[t], backgroundColor: `${TIER_COLORS()[t]}22` }]}>
                  <Text style={[s.chipText, currentTier === t && { color: TIER_COLORS()[t] }]}>
                    {tierLabel(t)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.sectionLabel, { marginTop: 12 }]}>SET VERIFICATION</Text>
            {currentVerif === "instagram" ? <Text style={s.meta}>Currently verified via Instagram</Text> : null}
            <View style={s.chipRow}>
              {VERIF_LEVELS.map((v) => (
                <Pressable key={v} onPress={() => void setVerification(player, v)} disabled={!!busy}
                  style={[s.chip, currentVerif === v && { borderColor: themeColor().pitch, backgroundColor: themeColor().pitch }]}>
                  <Text style={[s.chipText, currentVerif === v && { color: themeColor().pitchText }]}>
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

function make_s() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColor().bg, padding: 16 },
  title: { color: themeColor().text, fontSize: 24, ...headline, marginBottom: 16, marginTop: 8 },
  searchRow: { flexDirection: "row", alignItems: "center", backgroundColor: themeColor().overlay, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 16 },
  searchInput: { flex: 1, color: themeColor().text, fontSize: 16, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: themeColor().card, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: 999, backgroundColor: themeColor().pitchPanel, alignItems: "center", justifyContent: "center" },
  avatarText: { color: themeColor().onPitchPanel, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
  meta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "500", color: themeColor().muted, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: themeColor().line, backgroundColor: themeColor().overlaySubtle },
  chipText: { color: themeColor().muted, fontWeight: "600", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20 },
});
}
let s = make_s();
function publish_s() {
  s = make_s();
}

