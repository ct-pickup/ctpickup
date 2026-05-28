import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminBulkMessageCount,
  fetchAdminPickupSwitchList,
  postAdminBulkMessage,
} from "@/lib/adminApi";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LIME = "#a3e635";
const RED = "#ef4444";

const REGIONS = ["CT", "NY", "NJ", "MD"] as const;

/** API filter_value; matches server tier_rank mapping (last chip = open/public rank 6). */
const TIER_CHIPS: { label: string; value: string }[] = [
  { label: "1A", value: "1a" },
  { label: "1B", value: "1b" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "4", value: "4" },
  { label: "5", value: "5" },
];

type Audience = "all" | "region" | "tier" | "run";

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function fmtRunLine(row: Record<string, unknown>): string {
  const title = s(row.title).trim() || "Run";
  const region = s(row.service_region).trim();
  const start = s(row.start_at).trim();
  let when = "";
  if (start) {
    try {
      when = new Date(start).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      when = "";
    }
  }
  const bits = [title, region, when].filter(Boolean);
  return bits.join(" · ");
}

export default function AdminBulkMessageScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [audience, setAudience] = useState<Audience>("all");
  const [region, setRegion] = useState<(typeof REGIONS)[number] | null>(null);
  const [tierValue, setTierValue] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const audienceReady = useMemo(() => {
    if (audience === "all") return true;
    if (audience === "region") return !!region;
    if (audience === "tier") return !!tierValue;
    if (audience === "run") return !!runId;
    return false;
  }, [audience, region, tierValue, runId]);

  const filterValueForApi = useMemo(() => {
    if (audience === "all") return null;
    if (audience === "region") return region;
    if (audience === "tier") return tierValue;
    if (audience === "run") return runId;
    return null;
  }, [audience, region, tierValue, runId]);

  useEffect(() => {
    if (audience !== "run" || !token) return;
    let cancelled = false;
    setRunsLoading(true);
    void fetchAdminPickupSwitchList(token)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setRuns([]);
          return;
        }
        const list = (res.data as { runs?: unknown }).runs;
        setRuns(Array.isArray(list) ? (list as Record<string, unknown>[]) : []);
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audience, token]);

  const refreshCount = useCallback(async () => {
    if (!token || !audienceReady) {
      setCount(null);
      setCountError(null);
      setCountLoading(false);
      return;
    }
    setCountLoading(true);
    setCountError(null);
    const res = await fetchAdminBulkMessageCount(token, {
      filter: audience,
      filter_value: filterValueForApi,
    });
    setCountLoading(false);
    if (!res.ok) {
      setCount(null);
      setCountError(res.error);
      return;
    }
    const n = (res.data as { count?: unknown }).count;
    setCount(typeof n === "number" ? n : null);
  }, [token, audience, audienceReady, filterValueForApi]);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshCount();
    }, 250);
    return () => clearTimeout(t);
  }, [refreshCount]);

  useEffect(() => {
    if (audience === "region" && !region) setCount(null);
    if (audience === "tier" && !tierValue) setCount(null);
    if (audience === "run" && !runId) setCount(null);
  }, [audience, region, tierValue, runId]);

  useEffect(() => {
    setFormError(null);
  }, [message]);

  useEffect(() => {
    setSuccessText(null);
    setFormError(null);
  }, [audience, region, tierValue, runId]);

  function onAudienceChange(next: Audience) {
    setAudience(next);
    if (next !== "region") setRegion(null);
    if (next !== "tier") setTierValue(null);
    if (next !== "run") setRunId(null);
  }

  async function doSend() {
    if (!token) return;
    const trimmed = message.trim();
    if (!trimmed) {
      setFormError("Enter a message.");
      return;
    }
    if (trimmed.length > 500) {
      setFormError("Message must be at most 500 characters.");
      return;
    }
    if (!audienceReady || count == null) {
      setFormError("Choose a complete audience and wait for the recipient count.");
      return;
    }
    setSendBusy(true);
    setFormError(null);
    const res = await postAdminBulkMessage(token, {
      filter: audience,
      filter_value: audience === "all" ? undefined : filterValueForApi ?? undefined,
      message: trimmed,
    });
    setSendBusy(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    const sent = (res.data as { sent_to?: unknown }).sent_to;
    const n = typeof sent === "number" ? sent : count;
    setSuccessText(`Message sent to ${n} players ✓`);
    setMessage("");
  }

  function confirmSend() {
    if (count == null || !audienceReady) return;
    Alert.alert("Send broadcast?", `Send to ${count} players?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Send", style: "default", onPress: () => void doSend() },
    ]);
  }

  const canSend =
    !!token &&
    audienceReady &&
    count != null &&
    count > 0 &&
    message.trim().length > 0 &&
    message.trim().length <= 500 &&
    !sendBusy;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 56}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>TARGET AUDIENCE</Text>
        <Text style={styles.fieldLabel}>Send to</Text>

        <View style={styles.chipRow}>
          {(
            [
              { key: "all" as const, label: "All Players" },
              { key: "region" as const, label: "By Region" },
              { key: "tier" as const, label: "By Tier" },
              { key: "run" as const, label: "Confirmed for a Run" },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => onAudienceChange(opt.key)}
              style={({ pressed }) => [
                styles.chip,
                audience === opt.key && styles.chipOn,
                pressed && { opacity: 0.92 },
              ]}
            >
              <Text style={[styles.chipText, audience === opt.key && styles.chipTextOn]} numberOfLines={2}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {audience === "region" ? (
          <View style={styles.subBlock}>
            <Text style={styles.subLabel}>Region</Text>
            <View style={styles.chipRow}>
              {REGIONS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRegion(r)}
                  style={({ pressed }) => [
                    styles.chipSm,
                    region === r && styles.chipOn,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Text style={[styles.chipText, region === r && styles.chipTextOn]}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {audience === "tier" ? (
          <View style={styles.subBlock}>
            <Text style={styles.subLabel}>Tier</Text>
            <View style={styles.chipRow}>
              {TIER_CHIPS.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => setTierValue(t.value)}
                  style={({ pressed }) => [
                    styles.chipSm,
                    tierValue === t.value && styles.chipOn,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Text style={[styles.chipText, tierValue === t.value && styles.chipTextOn]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {audience === "run" ? (
          <View style={styles.subBlock}>
            <Text style={styles.subLabel}>Run</Text>
            {runsLoading ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: 12 }} />
            ) : runs.length === 0 ? (
              <Text style={styles.muted}>No runs found.</Text>
            ) : (
              <View style={styles.runList}>
                {runs.map((row) => {
                  const id = s(row.id);
                  if (!id) return null;
                  const selected = runId === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setRunId(id)}
                      style={({ pressed }) => [
                        styles.runCard,
                        selected && styles.runCardOn,
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Text style={styles.runCardText}>{fmtRunLine(row)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>PREVIEW COUNT</Text>
        <View style={styles.previewBox}>
          {!audienceReady ? (
            <Text style={styles.muted}>Select who should receive this message.</Text>
          ) : countLoading ? (
            <View style={styles.previewRow}>
              <ActivityIndicator color={LIME} size="small" />
              <Text style={styles.previewMain}>Loading count…</Text>
            </View>
          ) : countError ? (
            <Text style={styles.errText}>{countError}</Text>
          ) : count != null ? (
            <Text style={styles.previewMain}>
              {count} player{count === 1 ? "" : "s"} will receive this message
            </Text>
          ) : (
            <Text style={styles.muted}>Could not load count.</Text>
          )}
        </View>

        <Text style={styles.sectionLabel}>MESSAGE</Text>
        <TextInput
          style={styles.input}
          placeholder="Write your announcement…"
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          maxLength={500}
          value={message}
          onChangeText={setMessage}
          textAlignVertical="top"
        />
        <Text style={styles.counter}>
          {message.length}/500
        </Text>

        {formError ? <Text style={styles.errText}>{formError}</Text> : null}
        {successText ? <Text style={styles.okText}>{successText}</Text> : null}

        <Pressable
          onPress={() => confirmSend()}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendBtn,
            !canSend && styles.sendBtnDisabled,
            pressed && canSend && { opacity: 0.9 },
          ]}
        >
          <Text style={styles.sendBtnText}>{sendBusy ? "Sending…" : "Send"}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 12 },
  sectionLabel: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.45)",
  },
  fieldLabel: { marginTop: 10, fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.85)" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
    maxWidth: "48%",
    flexGrow: 1,
  },
  chipSm: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipOn: {
    borderColor: LIME,
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  chipText: { color: "rgba(255,255,255,0.82)", fontSize: 13, fontWeight: "600", textAlign: "center" },
  chipTextOn: { color: "#fff" },
  subBlock: { marginTop: 14 },
  subLabel: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.7)", marginBottom: 6 },
  muted: { color: "rgba(255,255,255,0.45)", fontSize: 14, lineHeight: 20 },
  runList: { gap: 8, marginTop: 4 },
  runCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  runCardOn: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.1)" },
  runCardText: { color: "rgba(255,255,255,0.88)", fontSize: 14, lineHeight: 20 },
  previewBox: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewMain: { color: "#fff", fontSize: 15, fontWeight: "600", lineHeight: 22, flex: 1 },
  input: {
    marginTop: 10,
    minHeight: 120,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 15,
    lineHeight: 22,
  },
  counter: { marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.45)", textAlign: "right" },
  errText: { marginTop: 10, color: RED, fontSize: 14, lineHeight: 20 },
  okText: { marginTop: 10, color: LIME, fontSize: 15, fontWeight: "600" },
  sendBtn: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: LIME,
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnText: { color: "#0a0a0a", fontSize: 16, fontWeight: "800" },
});
