import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlayerAvatar from "@/components/PlayerAvatar";
import { StarLevelSelect } from "@/components/StarLevels";
import { useAuth } from "@/context/AuthContext";
import { INSTAGRAM_VERIFICATION_HANDLE } from "@/lib/brand";
import { siteOrigin } from "@/lib/env";
import { approveInstagramRequest, fetchInstagramQueue, rejectInstagramRequest } from "@/lib/instagramVerifyApi";
import { tabBarContentPadding } from "@/lib/tabBar";
import { timeAgo } from "@/lib/timeAgo";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { maskedVerificationHint } from "@shared/instagramVerification";
import { starLevelLabel } from "@shared/starLevels";

type Kind = "instagram" | "document";
type Filter = "all" | Kind;

type InboxItem = {
  key: string;
  kind: Kind;
  id: string;
  name: string;
  avatarUrl: string | null;
  /** "@handle" for Instagram, "Document" for documents. */
  subtitle: string;
  createdAt: string;
  // Instagram
  handle?: string;
  codeHint?: string;
  // Document
  claim?: string;
  evidenceUrl?: string;
  /** Level the player claimed or stated, offered as the starting pick (1.0 and up only). */
  suggestedLevel?: number | null;
};

type DocumentApiItem = {
  id: string;
  claim: string;
  evidence_url: string;
  created_at: string;
  claimed_level: number | null;
  stated_level: number | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "instagram", label: "Instagram" },
  { key: "document", label: "Document" },
];

function splitName(name: string) {
  const [first, ...rest] = name.split(" ");
  return { first_name: first ?? null, last_name: rest.join(" ") || null };
}

/** One inbox for pending Instagram and document verification requests, newest first. */
export default function AdminVerificationScreen() {
  useThemedStyles(publish_s);
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const origin = siteOrigin();
    if (!origin || !token) return;
    setLoading(true);
    try {
      const [docRes, igRes] = await Promise.all([
        fetch(`${origin}/api/admin/verification?status=pending`, { headers: { Authorization: `Bearer ${token}` } })
          .then(async (r) => ({ ok: r.ok, json: (await r.json().catch(() => null)) as { items?: DocumentApiItem[] } | null }))
          .catch(() => ({ ok: false, json: null })),
        fetchInstagramQueue(token),
      ]);
      const docs: InboxItem[] = (docRes.json?.items ?? []).map((d) => {
        const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || d.username || "Player";
        const suggested = d.claimed_level ?? d.stated_level;
        return {
          key: `document:${d.id}`,
          kind: "document",
          id: d.id,
          name,
          avatarUrl: d.avatar_url,
          subtitle: "Document",
          createdAt: d.created_at,
          claim: d.claim,
          evidenceUrl: d.evidence_url,
          suggestedLevel: suggested != null && suggested >= 1 ? suggested : null,
        };
      });
      const igItems = igRes.ok ? (igRes.data.items ?? []).filter((i) => i.status === "pending") : [];
      const igs: InboxItem[] = igItems.map((i) => ({
        key: `instagram:${i.id}`,
        kind: "instagram",
        id: i.id,
        name: i.name,
        avatarUrl: i.avatar_url,
        subtitle: `@${i.handle}`,
        createdAt: i.created_at,
        handle: i.handle,
        codeHint: i.code_hint,
      }));
      setItems([...docs, ...igs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      setLoadError(docRes.ok && igRes.ok ? null : "Some requests did not load. Pull down or reopen to retry.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const visible = useMemo(() => items.filter((i) => filter === "all" || i.kind === filter), [items, filter]);
  const active = activeKey ? (items.find((i) => i.key === activeKey) ?? null) : null;

  /** Remove the finished request and open the next one in the current list, or close the sheet. */
  const finish = useCallback(
    (key: string) => {
      const order = visible.map((i) => i.key);
      const at = order.indexOf(key);
      const next = order[at + 1] ?? order[at - 1] ?? null;
      setItems((cur) => cur.filter((i) => i.key !== key));
      setActiveKey(next && next !== key ? next : null);
    },
    [visible],
  );

  if (loading && items.length === 0) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={themeColor().pitchText} size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarContentPadding(insets.bottom) }}
        ListHeaderComponent={
          <View>
            <Text style={s.pageTitle}>Verification</Text>
            <View style={s.chips}>
              {FILTERS.map((f) => (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[s.chip, filter === f.key && s.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f.key }}
                >
                  <Text style={[s.chipText, filter === f.key && s.chipTextOn]}>{f.label}</Text>
                </Pressable>
              ))}
            </View>
            {loadError ? <Text style={s.error}>{loadError}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>No pending requests.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setActiveKey(item.key)}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.subtitle}, ${timeAgo(item.createdAt)}`}
          >
            <PlayerAvatar person={{ ...splitName(item.name), avatar_url: item.avatarUrl }} size={40} />
            <View style={s.rowText}>
              <Text style={s.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={s.meta} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
            <Text style={s.ago}>{timeAgo(item.createdAt)}</Text>
            <FontAwesome name="chevron-right" size={12} color={themeColor().muted} />
          </Pressable>
        )}
      />

      <Modal visible={active != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setActiveKey(null)}>
        {active ? (
          <RequestSheet
            key={active.key}
            item={active}
            token={token}
            remaining={visible.length}
            onClose={() => setActiveKey(null)}
            onDone={() => finish(active.key)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function RequestSheet({
  item,
  token,
  remaining,
  onClose,
  onDone,
}: {
  item: InboxItem;
  token: string | null;
  remaining: number;
  onClose: () => void;
  onDone: () => void;
}) {
  useThemedStyles(publish_s);
  const insets = useSafeAreaInsets();
  const [level, setLevel] = useState<number | null>(item.suggestedLevel ?? null);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    if (!token || busy) return;
    if (level == null) {
      setError("Choose a starting level.");
      return;
    }
    if (item.kind === "instagram" && !code.trim()) {
      setError("Enter the code from the DM.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (item.kind === "instagram") {
        const res = await approveInstagramRequest(token, item.id, code.trim(), level);
        if (!res.ok) {
          setError(res.error);
          return;
        }
      } else {
        const origin = siteOrigin();
        if (!origin) {
          setError("Missing site URL.");
          return;
        }
        const r = await fetch(`${origin}/api/admin/verification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ request_id: item.id, decision: "approved", level }),
        });
        const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!r.ok || !j?.ok) {
          setError(j?.error ?? "Could not approve.");
          return;
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!token || busy) return;
    if (item.kind === "instagram" && !reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (item.kind === "instagram") {
        const res = await rejectInstagramRequest(token, item.id, reason.trim());
        if (!res.ok) {
          setError(res.error);
          return;
        }
      } else {
        const origin = siteOrigin();
        if (!origin) {
          setError("Missing site URL.");
          return;
        }
        const r = await fetch(`${origin}/api/admin/verification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ request_id: item.id, decision: "rejected" }),
        });
        const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!r.ok || !j?.ok) {
          setError(j?.error ?? "Could not reject.");
          return;
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  function confirmReject() {
    if (item.kind === "instagram") {
      setRejecting(true);
      return;
    }
    Alert.alert("Reject?", `Reject ${item.name}'s verification request?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Reject", style: "destructive", onPress: () => void reject() },
    ]);
  }

  return (
    <KeyboardAvoidingView style={s.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.sheetHeader}>
        <Text style={s.sheetTitle}>{item.kind === "instagram" ? "Instagram request" : "Document request"}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <FontAwesome name="times" size={18} color={themeColor().muted} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.sheetBody, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]} keyboardShouldPersistTaps="handled">
        <View style={s.person}>
          <PlayerAvatar person={{ ...splitName(item.name), avatar_url: item.avatarUrl }} size={48} />
          <View style={s.rowText}>
            <Text style={s.name}>{item.name}</Text>
            <Text style={s.meta}>
              {item.subtitle} · {timeAgo(item.createdAt)}
            </Text>
          </View>
        </View>
        {remaining > 1 ? <Text style={s.queueNote}>{remaining - 1} more waiting</Text> : null}

        {item.kind === "instagram" ? (
          <>
            <Text style={s.label}>Code from the DM to @{INSTAGRAM_VERIFICATION_HANDLE}</Text>
            {item.codeHint ? <Text style={s.hint}>Ends in {maskedVerificationHint(item.codeHint)}</Text> : null}
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="CTP-XXXXXX"
              placeholderTextColor={themeColor().muted}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              style={s.input}
            />
          </>
        ) : (
          <>
            <Text style={s.label}>Claim</Text>
            <Text style={s.body}>{item.claim}</Text>
            {item.evidenceUrl ? (
              <Pressable onPress={() => void Linking.openURL(item.evidenceUrl as string)} style={s.urlRow} accessibilityRole="link">
                <FontAwesome name="external-link" size={12} color={themeColor().pitchText} />
                <Text style={s.urlText} numberOfLines={1}>
                  {item.evidenceUrl}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}

        <Text style={s.label}>Starting level</Text>
        <Text style={s.hint}>
          {item.kind === "instagram"
            ? "Above 3.0 lifts the unverified cap; 3.0 and below keeps it."
            : level != null
              ? `Approving sets ${starLevelLabel(level)}.`
              : "Choose the verified level."}
        </Text>
        <StarLevelSelect
          value={level}
          onChange={setLevel}
          minStar={1}
          title="Starting level"
          placeholder="Choose a starting level…"
          style={s.levelSelect}
        />

        {rejecting ? (
          <>
            <Text style={s.label}>Reason the player will see</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="What should they fix?"
              placeholderTextColor={themeColor().muted}
              multiline
              editable={!busy}
              style={[s.input, s.inputMulti]}
            />
          </>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <View style={s.actions}>
          {rejecting ? (
            <Pressable onPress={() => setRejecting(false)} disabled={busy} style={s.ghostBtn} accessibilityRole="button">
              <Text style={s.ghostText}>Back</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={rejecting ? () => void reject() : confirmReject}
            disabled={busy}
            style={[s.rejectBtn, busy && s.disabled]}
            accessibilityRole="button"
          >
            <Text style={s.rejectText}>{rejecting ? "Send rejection" : "Reject"}</Text>
          </Pressable>
          {!rejecting ? (
            <Pressable onPress={() => void approve()} disabled={busy} style={[s.approveBtn, busy && s.disabled]} accessibilityRole="button">
              {busy ? <ActivityIndicator color={themeColor().onPitch} size="small" /> : <Text style={s.approveText}>Approve</Text>}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function make_s() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
    pageTitle: { color: c.text, fontSize: 24, ...headline, marginTop: 8, marginBottom: 12 },
    chips: { flexDirection: "row", gap: 8, marginBottom: 16 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line },
    chipOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    chipText: { color: c.text, fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    chipTextOn: { color: c.onPitch },
    error: { color: c.coralText, fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 8 },
    emptyCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 20, alignItems: "center" },
    emptyText: { color: c.muted, fontSize: 14, fontFamily: "Inter_400Regular" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.line,
      padding: 12,
      marginBottom: 8,
    },
    rowText: { flex: 1, minWidth: 0 },
    name: { color: c.text, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    meta: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
    ago: { color: c.muted, fontSize: 12, fontFamily: "Inter_500Medium" },

    sheet: { flex: 1, backgroundColor: c.bg },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 20,
      paddingTop: 24,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    sheetTitle: { color: c.text, fontSize: 20, ...headline },
    sheetBody: { padding: 20, gap: 8 },
    person: { flexDirection: "row", alignItems: "center", gap: 12 },
    queueNote: { color: c.muted, fontSize: 12, fontFamily: "Inter_500Medium" },
    label: { marginTop: 12, color: c.muted, fontSize: 13, fontFamily: "Inter_700Bold", fontWeight: "700" },
    hint: { color: c.muted, fontSize: 13, fontFamily: "Inter_400Regular" },
    body: { color: c.text, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
    urlRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.pitchPanel, borderRadius: 10, borderWidth: 1, borderColor: c.pitch, padding: 8 },
    urlText: { flex: 1, color: c.pitchText, fontSize: 13, fontFamily: "Inter_400Regular" },
    input: {
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: c.text,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      backgroundColor: c.bg,
    },
    inputMulti: { minHeight: 72, textAlignVertical: "top" },
    levelSelect: { marginTop: 4 },
    actions: { flexDirection: "row", gap: 8, marginTop: 16 },
    ghostBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.line, alignItems: "center" },
    ghostText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    rejectBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.coral, alignItems: "center" },
    rejectText: { color: c.coralText, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    approveBtn: { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: c.pitch, alignItems: "center" },
    approveText: { color: c.onPitch, fontWeight: "800", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
let s = make_s();
function publish_s() {
  s = make_s();
}
