import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { accountStyles as styles, publish_accountStyles } from "@/components/account/accountStyles";
import {
  DEFAULT_PUSH_SETTINGS,
  PUSH_CATEGORY_ROWS,
  deviceTimeZone,
  fetchPushSettings,
  formatMinutes,
  quietSummary,
  savePushSettings,
  stepMinutes,
  type PushCategoryKey,
  type PushSettings,
} from "@/lib/pushSettings";
import { radius, themeColor, useThemedStyles } from "@/theme";

/**
 * What we may push, and when. Behind the 'notification_settings' flag (the parent only renders this when it is on).
 * Each switch saves at once. Quiet hours use the device time zone and are saved with it.
 */
export function NotificationSettings({ token, pushEnabled, onMarketingChanged }: { token: string | null; pushEnabled: boolean; onMarketingChanged?: (next: boolean) => void }) {
  useThemedStyles(publish_accountStyles);
  useThemedStyles(publish_local);
  const [settings, setSettings] = useState<PushSettings>(DEFAULT_PUSH_SETTINGS);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    void fetchPushSettings(token).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setSettings(r.settings);
        setState("ready");
      } else setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = useCallback(
    async (next: PushSettings, update: Parameters<typeof savePushSettings>[1]) => {
      if (!token) return;
      const before = settings;
      setSettings(next);
      setBusy(true);
      setMessage(null);
      const r = await savePushSettings(token, update);
      setBusy(false);
      if (!r.ok) {
        setSettings(before);
        setMessage("We couldn’t save that. Try again.");
        return;
      }
      setSettings(r.settings);
      if (update.categories?.marketing !== undefined) onMarketingChanged?.(r.settings.categories.marketing);
    },
    [token, settings, onMarketingChanged],
  );

  const setCategory = (key: PushCategoryKey, value: boolean) =>
    void save({ ...settings, categories: { ...settings.categories, [key]: value } }, { categories: { [key]: value } });

  const q = settings.quiet;
  const setQuiet = (patch: Partial<PushSettings["quiet"]>) => {
    const next = { ...q, ...patch };
    const tz = deviceTimeZone();
    void save(
      { ...settings, quiet: { ...next, timezone: tz ?? next.timezone } },
      { quiet: { enabled: next.enabled, start: next.start, end: next.end, ...(tz ? { timezone: tz } : {}) } },
    );
  };

  if (state === "loading") return <ActivityIndicator color={themeColor().muted} style={local.loading} />;
  if (state === "error") return <Text style={styles.bioHint}>Notification settings aren’t available right now.</Text>;

  return (
    <View style={styles.card}>
      <Text style={styles.fieldLabelStrong}>Notification types</Text>
      {!pushEnabled ? <Text style={styles.bioHint}>Push notifications are off above. Turn them on to get any of these.</Text> : null}
      {PUSH_CATEGORY_ROWS.map((row) => (
        <View key={row.key} style={[styles.rowBetween, styles.marketingPushRow]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.fieldLabelStrong}>{row.title}</Text>
            <Text style={styles.bioHint}>{row.sub}</Text>
          </View>
          <Switch
            value={settings.categories[row.key]}
            onValueChange={(v) => setCategory(row.key, v)}
            disabled={busy || !pushEnabled}
            trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
            thumbColor={themeColor().text}
            accessibilityLabel={row.title}
          />
        </View>
      ))}

      <View style={[styles.rowBetween, styles.marketingPushRow]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.fieldLabelStrong}>Quiet hours</Text>
          <Text style={styles.bioHint}>{q.enabled ? `No pushes from ${quietSummary(q)}. A spot opening just before kickoff and a cancellation for a game today still come through.` : "Pause pushes overnight."}</Text>
        </View>
        <Switch
          value={q.enabled}
          onValueChange={(v) => setQuiet({ enabled: v })}
          disabled={busy || !pushEnabled}
          trackColor={{ false: themeColor().overlayStrong, true: themeColor().pitch }}
          thumbColor={themeColor().text}
          accessibilityLabel="Quiet hours"
        />
      </View>
      {q.enabled ? (
        <View style={local.times}>
          <TimeStepper label="From" value={q.start} disabled={busy} onChange={(v) => setQuiet({ start: v })} />
          <TimeStepper label="Until" value={q.end} disabled={busy} onChange={(v) => setQuiet({ end: v })} />
          <Text style={styles.bioHint}>Time zone: {q.timezone ?? deviceTimeZone() ?? "US Eastern"}</Text>
        </View>
      ) : null}
      {message ? <Text style={styles.msg}>{message}</Text> : null}
    </View>
  );
}

function TimeStepper({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <View style={local.stepRow}>
      <Text style={local.stepLabel}>{label}</Text>
      <Pressable style={local.stepBtn} disabled={disabled} onPress={() => onChange(stepMinutes(value, -30))} accessibilityRole="button" accessibilityLabel={`${label} earlier by 30 minutes`}>
        <Text style={local.stepBtnText}>−</Text>
      </Pressable>
      <Text style={local.stepValue} accessibilityLabel={`${label} ${formatMinutes(value)}`}>{formatMinutes(value)}</Text>
      <Pressable style={local.stepBtn} disabled={disabled} onPress={() => onChange(stepMinutes(value, 30))} accessibilityRole="button" accessibilityLabel={`${label} later by 30 minutes`}>
        <Text style={local.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

function make_local() {
  const c = themeColor();
  return StyleSheet.create({
    loading: { marginVertical: 16 },
    times: { gap: 10, marginBottom: 8 },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    stepLabel: { width: 52, fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.text },
    stepBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    stepBtnText: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: c.text },
    stepValue: { minWidth: 86, textAlign: "center", fontSize: 16, fontFamily: "Inter_600SemiBold", color: c.text },
  });
}
let local = make_local();
function publish_local() {
  local = make_local();
}
