import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { ConfirmationBadge, SourceBadges, Tag } from "@/components/fields/FieldBits";
import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { fieldCountLabel, hasLights, isTurf, permitConfirmation, permitDetail, priceConfirmation, priceLabel, settingTag } from "@/lib/fields/presentation";
import { confirmVenue, fetchConfirmation } from "@/lib/fields/suggestionsApi";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

export default function FieldDetailScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { supabase, session } = useAuth();
  const [saved, setSaved] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listing: item, loading } = useFieldListing(id);
  const [confirm, setConfirm] = useState({ count: 0, mine: false });
  const uid = session?.user?.id ?? null;
  const venueKey = item?.venue.venue_key ?? null;

  // How many players said "Looks right", and whether you did.
  useEffect(() => {
    if (!supabase || !uid || !venueKey) return;
    let cancelled = false;
    void fetchConfirmation(supabase, venueKey, uid).then((c) => {
      if (!cancelled) setConfirm(c);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, uid, venueKey]);

  if (loading) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={themeColor().muted} />
      </FieldScreenShell>
    );
  }

  if (!item) {
    return (
      <FieldScreenShell fallback="/(tabs)/sessions?view=fields">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.title}>Field not found</Text>
        <Text style={styles.muted}>This field may have been removed.</Text>
      </FieldScreenShell>
    );
  }

  const v = item.venue;

  async function looksRight() {
    if (!supabase || !uid || confirm.mine) return;
    const res = await confirmVenue(supabase, v.venue_key, uid);
    if (res === "confirmed") setConfirm((c) => ({ count: c.count + 1, mine: true }));
    else if (res === "already") setConfirm((c) => ({ ...c, mine: true }));
    else Alert.alert("Couldn’t save", "Please try again.");
  }

  async function toggleSaved() {
    const uid = session?.user?.id;
    if (!supabase || !uid) return;
    const res = saved
      ? await supabase.from("saved_venues").delete().eq("user_id", uid).eq("venue_key", v.venue_key)
      : await supabase.from("saved_venues").insert({ user_id: uid, venue_key: v.venue_key });
    if (res.error) Alert.alert("Couldn’t save", "This field isn’t in the database yet.");
    else setSaved(!saved);
  }
  const permit = permitDetail(v);
  const surface = isTurf(v) ? "Turf" : v.surface ? v.surface.charAt(0).toUpperCase() + v.surface.slice(1) : "Unknown";
  const lights = v.lit == null || v.lit === "unknown" ? "Unknown" : hasLights(v) ? "Yes" : "No";
  const sub = [item.kind_label, item.distance_mi != null ? `${item.distance_mi.toFixed(1)} mi away` : null, FIELDS_SAMPLE_DATA ? "Sample data" : null].filter(Boolean).join(" · ");

  return (
    <FieldScreenShell
      fallback="/(tabs)/sessions?view=fields"
      footer={
        <>
          <Link href={{ pathname: "/field-request", params: { id: v.venue_key } }} asChild>
            <Pressable style={styles.cta} accessibilityRole="button">
              <Text style={styles.ctaText}>Request this field</Text>
            </Pressable>
          </Link>
          <Pressable onPress={() => router.push({ pathname: "/report-problem", params: { id: v.venue_key } })} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.report}>Report a problem</Text>
          </Pressable>
        </>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.sub}>{sub}</Text>
        <Text style={styles.title}>{v.name}</Text>
        {settingTag(v) ? (
          <View style={styles.tagRow}>
            <Tag label={settingTag(v)!} />
          </View>
        ) : null}
        <SourceBadges playerReported={v.source === "player"} confirmations={confirm.count} />
      </View>

      <View style={styles.stats}>
        <Stat label="Fields" value={fieldCountLabel(v)?.split(" ")[0] ?? "?"} />
        <Stat label="Surface" value={surface} />
        <Stat label="Lights" value={lights} />
      </View>

      <View style={styles.card}>
        <Row label="Price" badge={<ConfirmationBadge value={priceConfirmation(v)} />}>
          <Text style={styles.value}>{priceLabel(v) === "Free" ? "Free" : priceLabel(v).replace("/hr", " per hour")}</Text>
        </Row>
        <View style={styles.sep} />
        <Row label="Permit" badge={<ConfirmationBadge value={permitConfirmation(v)} />}>
          <Text style={styles.value}>{permit.title}</Text>
          {permit.sub ? <Text style={styles.muted}>{permit.sub}</Text> : null}
        </Row>
        {v.address ? (
          <>
            <View style={styles.sep} />
            <Row label="Address">
              <Text style={styles.value}>{v.address}</Text>
            </Row>
          </>
        ) : null}
      </View>

      <Pressable
        onPress={() => router.push({ pathname: "/field-schedule", params: { id: v.venue_key } })}
        style={styles.linkRow}
        accessibilityRole="button"
      >
        <Text style={styles.linkRowText}>See schedule</Text>
        <Text style={styles.linkRowChevron}>{"›"}</Text>
      </Pressable>
      <Pressable onPress={() => void looksRight()} disabled={confirm.mine} style={[styles.linkRow, confirm.mine && styles.linkRowDone]} accessibilityRole="button" accessibilityState={{ disabled: confirm.mine }}>
        <Text style={styles.linkRowText}>{confirm.mine ? "Thanks, you confirmed this" : "Looks right"}</Text>
      </Pressable>
      <Pressable onPress={() => void toggleSaved()} style={styles.linkRow} accessibilityRole="button" accessibilityState={{ selected: saved }}>
        <Text style={styles.linkRowText}>{saved ? "Saved. Tap to remove" : "Save this field for alerts"}</Text>
      </Pressable>
    </FieldScreenShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Row({ label, badge, children }: { label: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.label}>{label}</Text>
        {badge}
      </View>
      {children}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    title: { fontSize: 28, lineHeight: 32, ...headline, color: c.text },
    sub: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.muted },
    muted: { fontSize: 14, fontFamily: "Inter_400Regular", color: c.muted },
    stats: { flexDirection: "row", gap: 10 },
    stat: { flex: 1, padding: 12, borderRadius: radius.card, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 2 },
    statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.muted },
    statValue: { fontSize: 18, ...headline, color: c.text },
    card: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 16 },
    row: { gap: 4 },
    rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.muted },
    value: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
    linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: radius.card, backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().line },
    linkRowText: { fontSize: 16, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().text },
    linkRowChevron: { fontSize: 20, color: themeColor().muted },
    linkRowDone: { opacity: 0.6 },
    tagRow: { flexDirection: "row", marginTop: 6 },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: 14 },
    cta: { backgroundColor: c.pitch, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
    ctaText: { color: c.onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    report: { textAlign: "center", color: c.pitchText, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
