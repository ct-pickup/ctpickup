import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import { tabBarContentPadding } from "@/lib/tabBar";
import { timeAgo } from "@/lib/timeAgo";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";
import { draftMailto, formatRequestWhen, type AdminSettableStatus, type RequestStatus } from "@shared/fields/requestEmail";

type Tab = "new" | "waiting_on_school" | "approved" | "declined";
const TABS: { key: Tab; label: string }[] = [
  { key: "new", label: "New" },
  { key: "waiting_on_school", label: "Waiting on school" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
];

type Item = {
  id: string;
  venue_key: string;
  requested_date: string;
  start_time: string;
  duration_hours: number;
  players: number;
  estimate_cents: number | null;
  status: RequestStatus;
  draft_email: string | null;
  school_contact_email: string | null;
  created_at: string;
  requested_by: string;
  plan?: string | null;
  plan_kind?: "free" | "included" | "extra" | "season" | null;
  weeks?: number | null;
  venue: { name: string; booking_phone: string | null } | null;
};

/** Splits the stored "subject\n\nbody" draft back apart for the mailto link. */
function splitDraft(text: string | null): { subject: string; body: string } {
  const [subject, ...rest] = (text ?? "").split("\n\n");
  return { subject: subject ?? "", body: rest.join("\n\n") };
}

export default function AdminFieldRequestsScreen() {
  useThemedStyles(publish_styles);
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [tab, setTab] = useState<Tab>("new");
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<Record<string, string>>({});

  const load = useCallback(
    async (which: Tab) => {
      const origin = siteOrigin();
      if (!origin || !token) return;
      try {
        const r = await fetch(`${origin}/api/admin/field-requests?status=${which}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = (await r.json().catch(() => null)) as { items?: Item[]; counts?: Record<string, number>; error?: string } | null;
        if (!r.ok) throw new Error(j?.error ?? "Could not load requests.");
        setItems(j?.items ?? []);
        setCounts(j?.counts ?? {});
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load requests.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load(tab);
    }, [load, tab]),
  );

  async function patch(id: string, body: { status?: AdminSettableStatus; school_contact_email?: string }): Promise<boolean> {
    const origin = siteOrigin();
    if (!origin || !token) return false;
    setBusyId(id);
    try {
      const r = await fetch(`${origin}/api/admin/field-requests`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        Alert.alert("Could not update", j?.error ?? "Please try again.");
        return false;
      }
      await load(tab);
      return true;
    } finally {
      setBusyId(null);
    }
  }

  function confirmDecline(it: Item) {
    Alert.alert("Decline this request?", "The player gets a notification.", [
      { text: "Cancel", style: "cancel" },
      { text: "Decline", style: "destructive", onPress: () => void patch(it.id, { status: "declined" }) },
    ]);
  }

  async function sendEmail(it: Item) {
    const to = (emailDraft[it.id] ?? it.school_contact_email ?? "").trim();
    const url = draftMailto(to, splitDraft(it.draft_email));
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("No mail app", "Use Copy instead and paste the draft into your email.");
      return;
    }
    // We never send it for you. Once you have sent it, move the request along.
    if (it.status === "new") {
      Alert.alert("Sent it?", "Mark this request as waiting on the school, and the player is told.", [
        { text: "Not yet", style: "cancel" },
        { text: "Mark waiting", onPress: () => void patch(it.id, { status: "waiting_on_school" }) },
      ]);
    }
  }

  async function copyDraft(it: Item) {
    const d = splitDraft(it.draft_email);
    await Clipboard.setStringAsync(`Subject: ${d.subject}\n\n${d.body}`);
    Alert.alert("Copied", "Paste it into your email.");
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Requests</Text>
        <Text style={styles.adminTag}>ADMIN</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((t) => {
          const on = tab === t.key;
          const n = counts[t.key];
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{n ? `${t.label} · ${n}` : t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarContentPadding(insets.bottom) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(tab); }} tintColor={themeColor().muted} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <ActivityIndicator color={themeColor().muted} style={{ marginTop: 32 }} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No requests here.</Text>
        ) : (
          items.map((it) => {
            const open = openId === it.id;
            const when = formatRequestWhen(it.requested_date, it.start_time, Number(it.duration_hours));
            const email = emailDraft[it.id] ?? it.school_contact_email ?? "";
            const busy = busyId === it.id;
            return (
              <View key={it.id} style={styles.card}>
                <Pressable onPress={() => setOpenId(open ? null : it.id)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                  <Text style={styles.venue}>{it.venue?.name ?? it.venue_key}</Text>
                  <Text style={styles.sub}>
                    Requested by {it.requested_by} · {timeAgo(it.created_at)}
                  </Text>
                  {it.plan_kind ? (
                    <View style={styles.planRow}>
                      <View style={[styles.planTag, (it.plan_kind === "extra" || it.plan_kind === "season") && styles.planTagExtra]}>
                        <Text style={[styles.planTagText, (it.plan_kind === "extra" || it.plan_kind === "season") && styles.planTagTextExtra]}>
                          {it.plan_kind === "extra"
                            ? "EXTRA request"
                            : it.plan_kind === "season"
                              ? `SEASON${it.weeks ? ` · ${it.weeks} weeks` : ""}`
                              : it.plan_kind === "free"
                                ? "Free first request"
                                : "Included"}
                        </Text>
                      </View>
                      <Text style={styles.sub}>{it.plan === "concierge" ? "Concierge" : it.plan === "season" ? "Paid season" : "Do it yourself"}</Text>
                    </View>
                  ) : null}
                </Pressable>

                {open ? (
                  <View style={styles.detail}>
                    <Row label="When" value={when} />
                    <Row label="Players" value={String(it.players)} />
                    {it.weeks ? <Row label="Season" value={`Same time every week for ${it.weeks} weeks`} /> : null}
                    {it.estimate_cents != null ? <Row label="Estimate" value={it.estimate_cents === 0 ? "Free" : `$${(it.estimate_cents / 100).toFixed(0)}`} /> : null}

                    <Text style={styles.label}>School contact email</Text>
                    <View style={styles.emailRow}>
                      <TextInput
                        value={email}
                        onChangeText={(v) => setEmailDraft((m) => ({ ...m, [it.id]: v }))}
                        placeholder="Add the school's email"
                        placeholderTextColor={themeColor().muted}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        style={styles.input}
                        accessibilityLabel="School contact email"
                      />
                      <Pressable
                        onPress={() => void patch(it.id, { school_contact_email: email })}
                        disabled={busy || email === (it.school_contact_email ?? "")}
                        style={[styles.smallBtn, (busy || email === (it.school_contact_email ?? "")) && styles.disabled]}
                        accessibilityRole="button"
                      >
                        <Text style={styles.smallBtnText}>Save</Text>
                      </Pressable>
                    </View>

                    <Text style={styles.label}>DRAFT EMAIL TO SCHOOL</Text>
                    <View style={styles.draft}>
                      <Text style={styles.draftText} selectable>
                        {splitDraft(it.draft_email).body}
                      </Text>
                    </View>

                    <View style={styles.actions}>
                      <Pressable onPress={() => void sendEmail(it)} style={styles.primary} accessibilityRole="button">
                        <Text style={styles.primaryText}>Email the school</Text>
                      </Pressable>
                      <Pressable onPress={() => void copyDraft(it)} style={styles.secondary} accessibilityRole="button">
                        <Text style={styles.secondaryText}>Copy draft</Text>
                      </Pressable>
                      {it.venue?.booking_phone ? (
                        <Pressable onPress={() => void Linking.openURL(`tel:${it.venue!.booking_phone}`)} style={styles.secondary} accessibilityRole="button">
                          <Text style={styles.secondaryText}>Call school</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={styles.note}>Nothing is sent for you. You send the email yourself.</Text>

                    {busy ? <ActivityIndicator color={themeColor().muted} /> : (
                      <View style={styles.actions}>
                        {it.status === "new" ? (
                          <Pressable onPress={() => void patch(it.id, { status: "waiting_on_school" })} style={styles.secondary} accessibilityRole="button">
                            <Text style={styles.secondaryText}>Mark waiting on school</Text>
                          </Pressable>
                        ) : null}
                        {it.status !== "approved" ? (
                          <Pressable onPress={() => void patch(it.id, { status: "approved" })} style={styles.secondary} accessibilityRole="button">
                            <Text style={styles.secondaryText}>Mark approved</Text>
                          </Pressable>
                        ) : null}
                        {it.status !== "declined" ? (
                          <Pressable onPress={() => confirmDecline(it)} style={styles.secondary} accessibilityRole="button">
                            <Text style={styles.declineText}>Decline</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
    title: { fontSize: 32, ...headline, color: c.text },
    adminTag: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted },
    tabsScroll: { flexGrow: 0 },
    tabs: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
    tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    tabOn: { backgroundColor: c.pitch, borderColor: c.pitch },
    tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text },
    tabTextOn: { color: c.onPitch },
    content: { paddingHorizontal: 20, gap: 12 },
    error: { color: c.coralText, fontSize: 14, fontFamily: "Inter_500Medium" },
    empty: { color: c.muted, fontSize: 15, fontFamily: "Inter_400Regular", marginTop: 24, textAlign: "center" },
    card: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 14, gap: 10 },
    venue: { fontSize: 17, ...headline, color: c.text },
    sub: { fontSize: 13, fontFamily: "Inter_400Regular", color: c.muted, marginTop: 2 },
    planRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    planTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.overlaySubtle },
    planTagExtra: { backgroundColor: c.pitch },
    planTagText: { fontSize: 11, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.text },
    planTagTextExtra: { color: c.onPitch },
    detail: { gap: 10, paddingTop: 4 },
    row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
    rowLabel: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
    rowValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: c.text, flexShrink: 1, textAlign: "right" },
    label: { fontSize: 12, fontFamily: "Inter_700Bold", fontWeight: "700", color: c.muted, marginTop: 4 },
    emailRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    input: { flex: 1, height: 42, paddingHorizontal: 12, borderRadius: radius.button, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, color: c.text, fontSize: 15, fontFamily: "Inter_400Regular" },
    draft: { padding: 12, borderRadius: radius.card, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line },
    draftText: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.text, lineHeight: 20 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    primary: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: 16 },
    primaryText: { color: c.onPitch, fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700" },
    secondary: { borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
    secondaryText: { color: c.text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    declineText: { color: c.coralText, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    smallBtn: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: c.pitch },
    smallBtnText: { color: c.onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    disabled: { opacity: 0.4 },
    note: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.muted },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
