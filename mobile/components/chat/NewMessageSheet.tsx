import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlayerAvatar from "@/components/PlayerAvatar";
import type { DmTarget } from "@/components/chat/StartDmSheet";
import { useAuth } from "@/context/AuthContext";
import { headline, themeColor, useThemedStyles } from "@/theme";

type Found = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };

function displayName(p: Found): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Player";
}

/** Staff "New message": search players by name, then hand the pick to `onPick` (open or create the thread). */
export default function NewMessageSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (target: DmTarget) => void;
}) {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { supabase, session } = useAuth();
  const me = session?.user?.id ?? null;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const ticket = useRef(0);

  async function search(text: string) {
    setQuery(text);
    const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);
    if (!supabase || tokens.join("").length < 2) {
      setResults([]);
      return;
    }
    const mine = ++ticket.current;
    setSearching(true);
    let q = supabase.from("profiles").select("id,first_name,last_name,avatar_url");
    for (const t of tokens) {
      const safe = t.replace(/[%,()]/g, "");
      q = q.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
    }
    const { data } = await q.limit(20);
    if (mine !== ticket.current) return;
    setSearching(false);
    setResults(((data ?? []) as Found[]).filter((p) => p.id !== me));
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>New message</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <FontAwesome name="times" size={18} color={themeColor().muted} />
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={(t) => void search(t)}
          placeholder="Search players by name"
          placeholderTextColor={themeColor().muted}
          autoFocus
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {searching ? <ActivityIndicator color={themeColor().pitchText} style={styles.spinner} /> : null}
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
          ListEmptyComponent={
            query.trim().length >= 2 && !searching ? <Text style={styles.empty}>No players found.</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onPick({ userId: item.id, name: displayName(item) });
                onClose();
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <PlayerAvatar person={{ first_name: item.first_name, last_name: item.last_name, avatar_url: item.avatar_url }} size={40} />
              <Text style={styles.name}>{displayName(item)}</Text>
              <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingTop: 24 },
    title: { color: c.text, fontSize: 22, ...headline },
    input: {
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: c.text,
      fontSize: 16,
      fontFamily: "Inter_400Regular",
      backgroundColor: c.card,
    },
    spinner: { marginTop: 12 },
    empty: { color: c.muted, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 16 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    pressed: { opacity: 0.85 },
    name: { flex: 1, color: c.text, fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
