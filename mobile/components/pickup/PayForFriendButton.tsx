import { useAuth } from "@/context/AuthContext";
import { usePickupJoin } from "@/hooks/usePickupJoin";
import { hapticGoal, hapticTap } from "@/lib/haptics";
import { fetchPickupFindPlayers, type PickupFindPlayerResult } from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useState } from "react";
import { headline, themeColor, useThemedStyles } from "@/theme";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const FRIEND_FIND_NO_PLAYERS_MSG = "No players found. Try a different name or username.";

function isFriendFindNotFoundError(message: string | null | undefined): boolean {
  if (message == null || message === "") return false;
  if (message === "not_found") return true;
  return message.startsWith("not_found —");
}

type Props = {
  run: Record<string, unknown>;
  onSuccess: () => void;
};

export function PayForFriendButton({ run, onSuccess }: Props) {
  useThemedStyles(publish_styles);

  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const runId = typeof run.id === "string" ? run.id : null;
  const venueName =
    typeof run.location_text === "string" && run.location_text.trim()
      ? run.location_text.split(/\r?\n/)[0]?.trim() ?? ""
      : typeof run.title === "string"
        ? run.title.trim()
        : "";
  const { joinBusy, joinPickup } = usePickupJoin();

  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PickupFindPlayerResult | null>(null);
  const [suggestions, setSuggestions] = useState<PickupFindPlayerResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchEmpty, setSearchEmpty] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const resetModal = useCallback(() => {
    setQuery("");
    setSelected(null);
    setSuggestions([]);
    setSearchLoading(false);
    setSearchEmpty(false);
    setSearchError(null);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    resetModal();
  }, [resetModal]);

  const openModal = useCallback(() => {
    void hapticTap();
    resetModal();
    setModalOpen(true);
  }, [resetModal]);

  useEffect(() => {
    if (!modalOpen || !token) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const q = query.trim();

    if (q.length < 2) {
      setSuggestions([]);
      setSearchLoading(false);
      setSearchEmpty(false);
      setSearchError(null);
      return;
    }

    if (!runId) {
      setSuggestions([]);
      setSearchLoading(false);
      setSearchEmpty(false);
      setSearchError("No run is loaded — cannot search players.");
      return;
    }

    setSearchEmpty(false);
    setSearchError(null);

    timeoutId = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        setSearchLoading(true);
        setSuggestions([]);
        try {
          const r = await fetchPickupFindPlayers(token, q, { runId, limit: 8 });
          if (cancelled) return;
          if (r.ok) {
            setSuggestions(r.players);
            setSearchEmpty(r.players.length === 0);
            setSearchError(null);
          } else if (isFriendFindNotFoundError(r.error)) {
            setSuggestions([]);
            setSearchEmpty(true);
            setSearchError(null);
          } else {
            setSuggestions([]);
            setSearchEmpty(false);
            setSearchError(r.error ?? "Search failed. Try again.");
          }
        } catch (e) {
          if (!cancelled) {
            setSuggestions([]);
            setSearchEmpty(false);
            setSearchError(e instanceof Error ? e.message : "Network error. Try again.");
          }
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [modalOpen, token, query, runId]);

  const onSelectSuggestion = useCallback((p: PickupFindPlayerResult) => {
    void hapticTap();
    const display =
      p.full_name.trim().length > 0 ? p.full_name.trim() : (p.username && p.username.trim()) || "Player";
    setSelected(p);
    setQuery(display);
    setSuggestions([]);
    setSearchEmpty(false);
    setSearchError(null);
    Keyboard.dismiss();
  }, []);

  const onConfirmPay = useCallback(async () => {
    if (!selected || !runId || !token) return;
    if (selected.user_id === session?.user?.id) {
      Alert.alert("That's you", 'Use "I\'m In" to join for yourself.');
      return;
    }
    void hapticGoal();
    setModalOpen(false);
    await joinPickup(
      token,
      runId,
      async () => {
        onSuccess();
      },
      {
        friendUserId: selected.user_id,
        friendDisplayName: selected.full_name,
        venueName: venueName || undefined,
      },
    );
    resetModal();
  }, [selected, runId, token, session?.user?.id, joinPickup, onSuccess, resetModal, venueName]);

  return (
    <>
      <Pressable
        disabled={!token || joinBusy || !runId}
        onPress={openModal}
        style={({ pressed }) => [
          styles.btn,
          (!token || joinBusy || !runId) && styles.btnDisabled,
          pressed && token && !joinBusy && runId && { opacity: 0.9 },
        ]}
      >
        <FontAwesome name="user-plus" size={15} color={themeColor().pitchText} />
        <Text style={styles.btnText}> Pay for a friend</Text>
      </Pressable>

      <Modal visible={modalOpen} animationType="fade" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.backdropPress}
            onPress={closeModal}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
          <View style={styles.card}>
            <Text style={styles.title}>Pay for a friend</Text>
            <Text style={styles.hint}>Search by name from approved players.</Text>

            <TextInput
              style={styles.input}
              placeholder="Name or username"
              placeholderTextColor={themeColor().muted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={(t) => {
                setQuery(t);
                setSelected(null);
              }}
              editable={!joinBusy}
            />

            {searchLoading ? (
              <View style={styles.searchRow}>
                <ActivityIndicator color={themeColor().pitchText} size="small" />
                <Text style={styles.searchRowText}>Searching…</Text>
              </View>
            ) : null}

            {suggestions.length > 0 ? (
              <View style={styles.suggestions}>
                {suggestions.map((s, i) => (
                  <Pressable
                    key={s.user_id}
                    onPress={() => onSelectSuggestion(s)}
                    style={({ pressed }) => [
                      styles.suggestionRow,
                      i === suggestions.length - 1 && styles.suggestionRowLast,
                      pressed && { opacity: 0.88 },
                    ]}
                  >
                    <Text style={styles.suggestionName} numberOfLines={1}>
                      {s.full_name}
                    </Text>
                    {s.username ? (
                      <Text style={styles.suggestionUsername} numberOfLines={1}>
                        @{s.username}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            {query.trim().length >= 2 && !searchLoading && searchEmpty && !searchError ? (
              <Text style={styles.emptyHint}>{FRIEND_FIND_NO_PLAYERS_MSG}</Text>
            ) : null}
            {searchError ? <Text style={styles.errorHint}>{searchError}</Text> : null}

            {selected ? (
              selected.user_id === session?.user?.id ? (
                <Text style={styles.selfHint}>That&apos;s you — join for yourself with I&apos;m In.</Text>
              ) : (
                <>
                  <Text style={styles.selectedLine}>
                    Selected: <Text style={styles.selectedName}>{selected.full_name}</Text>
                  </Text>
                  <Pressable
                    disabled={joinBusy}
                    onPress={() => void onConfirmPay()}
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      joinBusy && styles.confirmBtnDisabled,
                      pressed && !joinBusy && { opacity: 0.9 },
                    ]}
                  >
                    {joinBusy ? (
                      <ActivityIndicator color={themeColor().onPitch} size="small" />
                    ) : (
                      <Text style={styles.confirmBtnText}>
                        Pay for {selected.full_name}
                        {typeof run.fee_cents === "number" && run.fee_cents > 0
                          ? ` ($${((run.fee_cents * 2) / 100).toFixed(2)})`
                          : ""}
                      </Text>
                    )}
                  </Pressable>
                </>
              )
            ) : null}

            <Pressable onPress={closeModal} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function make_styles() {
  return StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    backgroundColor: themeColor().pitchPanel,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: themeColor().onPitchPanel, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  backdrop: { flex: 1, justifyContent: "center", padding: 20 },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: themeColor().scrim,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
    padding: 16,
    gap: 8,
  },
  title: { color: themeColor().text, fontSize: 20, ...headline },
  hint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  input: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().overlaySubtle,
    color: themeColor().text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular",
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchRowText: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  suggestions: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    overflow: "hidden",
  },
  suggestionRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: themeColor().line,
  },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionName: { color: themeColor().text, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  suggestionUsername: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  emptyHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  errorHint: { color: themeColor().coralText, fontSize: 13, fontFamily: "Inter_400Regular" },
  selfHint: { color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular" },
  selectedLine: { color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  selectedName: { color: themeColor().text, fontWeight: "800" },
  confirmBtn: {
    marginTop: 4,
    backgroundColor: themeColor().pitch,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmBtnDisabled: { opacity: 0.65 },
  confirmBtnText: { color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold" },
  closeBtn: { alignItems: "center", paddingVertical: 8, marginTop: 4 },
  closeBtnText: { color: themeColor().muted, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

