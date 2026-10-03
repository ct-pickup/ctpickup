import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import PlayerAvatar from "@/components/PlayerAvatar";
import { useAuth } from "@/context/AuthContext";
import { StarLevelSelect } from "@/components/StarLevels";
import { approveInstagramRequest, fetchInstagramQueue, rejectInstagramRequest } from "@/lib/instagramVerifyApi";
import { themeColor, useThemedStyles } from "@/theme";
import { INSTAGRAM_VERIFICATION_HANDLE } from "@/lib/brand";
import { maskedVerificationHint, type InstagramVerificationQueueItem } from "@shared/instagramVerification";

type Mode = { id: string; kind: "approve" | "reject" } | null;

function splitName(name: string) {
  const [first, ...rest] = name.split(" ");
  return { first_name: first ?? null, last_name: rest.join(" ") || null };
}

/** Admin queue for Instagram DM verification. The code itself is never sent to the admin; they type it from the DM. */
export function InstagramVerificationQueue() {
  useThemedStyles(publish_s);
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [items, setItems] = useState<InstagramVerificationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await fetchInstagramQueue(token);
    if (res.ok) {
      setItems(res.data.items ?? []);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function open(id: string, kind: "approve" | "reject") {
    setMode({ id, kind });
    setInput("");
    setLevel(null);
    setInputError(null);
  }

  async function confirm(item: InstagramVerificationQueueItem) {
    if (!token || !mode || busyId) return;
    const value = input.trim();
    if (!value) {
      setInputError(mode.kind === "approve" ? "Enter the code from the DM." : "A reason is required.");
      return;
    }
    if (mode.kind === "approve" && level == null) {
      setInputError("Choose a starting level.");
      return;
    }
    setBusyId(item.id);
    const res =
      mode.kind === "approve"
        ? await approveInstagramRequest(token, item.id, value, level as number)
        : await rejectInstagramRequest(token, item.id, value);
    setBusyId(null);
    if (!res.ok) {
      setInputError(res.error);
      return;
    }
    setMode(null);
    await load();
    Alert.alert(mode.kind === "approve" ? "Approved" : "Rejected", `${item.name} @${item.handle}`);
  }

  const pending = items.filter((i) => i.status === "pending");
  const reviewed = items.filter((i) => i.status !== "pending");

  return (
    <View style={s.wrap}>
      <Text style={s.sectionTitle}>Instagram</Text>
      {loading && items.length === 0 ? <ActivityIndicator color={themeColor().pitchText} /> : null}
      {error ? <Text style={s.muted}>{error}</Text> : null}
      {!loading && !error && pending.length === 0 ? (
        <View style={s.card}>
          <Text style={s.muted}>No Instagram requests waiting.</Text>
        </View>
      ) : null}

      {pending.map((item) => {
        const active = mode?.id === item.id ? mode : null;
        const busy = busyId === item.id;
        return (
          <View key={item.id} style={s.card}>
            <View style={s.header}>
              <PlayerAvatar person={{ ...splitName(item.name), avatar_url: item.avatar_url }} size={40} />
              <View style={s.headerText}>
                <Text style={s.name}>{item.name}</Text>
                <Text style={s.meta}>
                  @{item.handle} · {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
            </View>
            <Text style={s.hint}>Code ends in {maskedVerificationHint(item.code_hint)}</Text>

            {active ? (
              <View style={s.entry}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={active.kind === "approve" ? "CTP-XXXXXX from the DM" : "Reason the player will see"}
                  placeholderTextColor={themeColor().muted}
                  autoCapitalize={active.kind === "approve" ? "characters" : "sentences"}
                  autoCorrect={active.kind === "reject"}
                  multiline={active.kind === "reject"}
                  style={s.input}
                  editable={!busy}
                />
                {active.kind === "approve" ? (
                  <View style={s.levelBox}>
                    <Text style={s.hint}>
                      @{item.handle} · DM sent to @{INSTAGRAM_VERIFICATION_HANDLE}
                    </Text>
                    <Text style={s.meta}>
                      Starting level. Above 3.0 lifts the unverified cap; 3.0 and below keeps it.
                    </Text>
                    <StarLevelSelect
                      value={level}
                      onChange={setLevel}
                      minStar={1}
                      title="Starting level"
                      placeholder="Choose a starting level…"
                    />
                  </View>
                ) : null}
                {inputError ? <Text style={s.error}>{inputError}</Text> : null}
                <View style={s.actions}>
                  <Pressable onPress={() => setMode(null)} disabled={busy} style={s.ghostBtn}>
                    <Text style={s.ghostText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void confirm(item)}
                    disabled={busy}
                    style={[active.kind === "approve" ? s.approveBtn : s.rejectBtn, busy && s.disabled]}
                  >
                    {busy ? (
                      <ActivityIndicator color={themeColor().onPitch} size="small" />
                    ) : (
                      <Text style={active.kind === "approve" ? s.approveText : s.rejectText}>
                        {active.kind === "approve" ? "Approve" : "Reject"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={s.actions}>
                <Pressable onPress={() => open(item.id, "reject")} style={s.rejectBtn}>
                  <Text style={s.rejectText}>Reject</Text>
                </Pressable>
                <Pressable onPress={() => open(item.id, "approve")} style={s.approveBtn}>
                  <Text style={s.approveText}>Enter code</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {reviewed.length > 0 ? (
        <>
          <Text style={s.subTitle}>Recently reviewed</Text>
          {reviewed.map((item) => (
            <View key={item.id} style={[s.card, s.reviewed]}>
              <Text style={s.name}>
                {item.name} · @{item.handle}
              </Text>
              <Text style={s.meta}>
                {item.status === "approved" ? "Approved" : "Rejected"}
                {item.reviewed_at ? ` · ${new Date(item.reviewed_at).toLocaleDateString()}` : ""}
              </Text>
              {item.reject_reason ? <Text style={s.meta}>{item.reject_reason}</Text> : null}
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function make_s() {
  return StyleSheet.create({
    wrap: { marginBottom: 24 },
    sectionTitle: { color: themeColor().text, fontSize: 18, fontFamily: "Inter_700Bold", fontWeight: "700", marginBottom: 12 },
    subTitle: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700", marginTop: 12, marginBottom: 8 },
    card: {
      backgroundColor: themeColor().card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: themeColor().line,
      padding: 16,
      marginBottom: 12,
      gap: 10,
    },
    reviewed: { opacity: 0.7, gap: 4 },
    header: { flexDirection: "row", alignItems: "center", gap: 12 },
    headerText: { flex: 1 },
    name: { color: themeColor().text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    meta: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
    muted: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
    hint: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    entry: { gap: 8 },
    levelBox: { gap: 6 },
    input: {
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: themeColor().text,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      backgroundColor: themeColor().bg,
    },
    error: { color: themeColor().coralText, fontSize: 13, fontFamily: "Inter_500Medium" },
    actions: { flexDirection: "row", gap: 8 },
    ghostBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: themeColor().line, alignItems: "center" },
    ghostText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    rejectBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: themeColor().coral, alignItems: "center" },
    rejectText: { color: themeColor().coralText, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    approveBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: themeColor().pitch, alignItems: "center" },
    approveText: { color: themeColor().onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    disabled: { opacity: 0.5 },
  });
}
let s = make_s();
function publish_s() {
  s = make_s();
}
