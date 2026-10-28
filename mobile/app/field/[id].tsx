import { useTrackOnce } from "@/lib/analytics/helpers";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ConfirmationBadge, OsmCredit, SourceBadges, Tag, VenueNotice } from "@/components/fields/FieldBits";
import { FieldScreenShell } from "@/components/fields/FieldScreenShell";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useFieldListing } from "@/hooks/useFieldListings";
import { closedBanner, fieldCountLabel, lastConfirmedLabel, hasLights, isTurf, permitConfirmation, permitDetail, priceConfirmation, priceLabel, settingTag } from "@/lib/fields/presentation";
import { directionsUrl } from "@/lib/fields/directions";
import { fetchApprovedRequest } from "@/lib/fields/gameLink";
import { formatRequestWhen } from "@shared/fields/requestEmail";
import { needsPermit, type PrefillRequest } from "@/lib/fields/gamePrefill";
import { confirmVenue, fetchConfirmation } from "@/lib/fields/suggestionsApi";
import { FIELDS_SAMPLE_DATA } from "@/lib/fields/config";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function FieldDetailScreen() {
  useThemedStyles(publish_styles);
  const router = useRouter();
  const { supabase, session } = useAuth();
  const { isAdmin } = useProfileAdmin();
  const [saved, setSaved] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { listing: item, loading } = useFieldListing(id);
  const [confirm, setConfirm] = useState({ count: 0, mine: false });
  // The player's own approved request for this field (no game yet), and the gentle permit prompt.
  const [approved, setApproved] = useState<PrefillRequest | null>(null);
  const [permitPrompt, setPermitPrompt] = useState(false);
  const uid = session?.user?.id ?? null;
  const venueKey = item?.venue.venue_key ?? null;
  useTrackOnce("field_viewed", venueKey, { venue_key: venueKey ?? "" });

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

  useEffect(() => {
    if (!supabase || !uid || !venueKey) return;
    let cancelled = false;
    void fetchApprovedRequest(supabase, uid, venueKey, localToday()).then((r) => {
      if (!cancelled) setApproved(r);
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

  function createGame(skipPermitPrompt = false) {
    if (!approved && !skipPermitPrompt && needsPermit(v)) {
      setPermitPrompt(true);
      return;
    }
    setPermitPrompt(false);
    router.push({ pathname: "/session-create", params: { venue_key: v.venue_key, ...(approved ? { request_id: approved.id } : {}) } });
  }

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
  const confirmed = lastConfirmedLabel(v.last_verified_at, new Date());
  const confirmedText = confirmed.stale ? `${confirmed.text} · may be out of date` : confirmed.text;
  const mapsUrl = directionsUrl(Platform.OS, v.lat, v.lon, v.name);
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

      {closedBanner(v, localToday()) ? (
        <View style={styles.closedBanner} accessibilityRole="alert">
          <Text style={styles.closedText}>{closedBanner(v, localToday())}</Text>
        </View>
      ) : null}

      <View style={styles.stats}>
        <Stat label="Fields" value={fieldCountLabel(v)?.split(" ")[0] ?? "?"} />
        <Stat label="Surface" value={surface} />
        <Stat label="Lights" value={lights} />
      </View>

      <View style={styles.card}>
        <Row label="Price" badge={<ConfirmationBadge value={priceConfirmation(v)} />}>
          <Text style={styles.value}>{priceLabel(v) === "Free" ? "Free" : priceLabel(v).replace("/hr", " per hour")}</Text>
          <Text style={styles.confirmed}>{confirmedText}</Text>
        </Row>
        <View style={styles.sep} />
        <Row label="Permit" badge={<ConfirmationBadge value={permitConfirmation(v)} />}>
          <Text style={styles.value}>{permit.title}</Text>
          {permit.sub ? <Text style={styles.muted}>{permit.sub}</Text> : null}
          <Text style={styles.confirmed}>{confirmedText}</Text>
        </Row>
        {v.residency_rule ? (
          <>
            <View style={styles.sep} />
            <Row label="Who can book">
              <Text style={styles.value}>{v.residency_rule}</Text>
            </Row>
          </>
        ) : null}
        {v.address ? (
          <>
            <View style={styles.sep} />
            <Row label="Address">
              <Text style={styles.value}>{v.address}</Text>
            </Row>
          </>
        ) : null}
      </View>

      {isAdmin && (v.player_notes?.trim() || v.availability_notes?.trim()) ? (
        <View style={styles.adminNotes}>
          <Text style={styles.adminNotesTitle}>Notes (admins only)</Text>
          <Text style={styles.adminNotesText} selectable>
            {[v.availability_notes?.trim() ? `Availability:\n${v.availability_notes.trim()}` : "", (v.player_notes ?? "").replace(/\[\/?research\]\n?/g, "").trim()].filter(Boolean).join("\n\n")}
          </Text>
        </View>
      ) : null}

      {approved ? (
        <View style={styles.approvedBox} accessibilityRole="alert">
          <Text style={styles.approvedTitle}>Your request for this field was approved.</Text>
          <Text style={styles.approvedText}>{formatRequestWhen(approved.requested_date, approved.start_time, Number(approved.duration_hours ?? 2))}</Text>
        </View>
      ) : null}
      <Pressable onPress={() => createGame()} style={styles.createGame} accessibilityRole="button" accessibilityLabel="Create a game here">
        <Text style={styles.createGameText}>Create a game here</Text>
      </Pressable>
      {permitPrompt ? (
        <View style={styles.permitBox}>
          <Text style={styles.permitText}>This field usually needs a permit. Request it first.</Text>
          <View style={styles.permitActions}>
            <Pressable onPress={() => router.push({ pathname: "/field-request", params: { id: v.venue_key } })} style={styles.permitPrimary} accessibilityRole="button">
              <Text style={styles.permitPrimaryText}>Request this field</Text>
            </Pressable>
            <Pressable onPress={() => createGame(true)} style={styles.permitSecondary} accessibilityRole="button">
              <Text style={styles.permitSecondaryText}>Continue without one</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {mapsUrl ? (
        <Pressable onPress={() => void Linking.openURL(mapsUrl).catch(() => Alert.alert("Couldn\u2019t open maps", "Open your maps app and search for the address instead."))} style={styles.linkRow} accessibilityRole="link" accessibilityLabel={`Get directions to ${v.name}`}>
          <Text style={styles.linkRowText}>Get directions</Text>
          <Text style={styles.linkRowChevron}>{"›"}</Text>
        </Pressable>
      ) : null}
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
      <VenueNotice />
      <OsmCredit />
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
    approvedBox: { padding: 14, borderRadius: radius.card, backgroundColor: themeColor().pitchPanel, borderWidth: 1, borderColor: themeColor().pitchText, gap: 2 },
    approvedTitle: { fontSize: 15, fontFamily: "Inter_700Bold", fontWeight: "700", color: themeColor().onPitchPanel },
    approvedText: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().onPitchPanel },
    createGame: { backgroundColor: themeColor().pitch, borderRadius: radius.button, paddingVertical: 14, alignItems: "center" },
    createGameText: { color: themeColor().onPitch, fontSize: 16, fontFamily: "Inter_700Bold", fontWeight: "700" },
    permitBox: { padding: 14, borderRadius: radius.card, backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().line, gap: 10 },
    permitText: { fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().text },
    permitActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    permitPrimary: { backgroundColor: themeColor().pitch, borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14 },
    permitPrimaryText: { color: themeColor().onPitch, fontSize: 14, fontFamily: "Inter_700Bold", fontWeight: "700" },
    permitSecondary: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: themeColor().line },
    permitSecondaryText: { color: themeColor().text, fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
    confirmed: { fontSize: 12, fontFamily: "Inter_400Regular", color: themeColor().muted },
    closedBanner: { padding: 14, borderRadius: radius.card, backgroundColor: themeColor().overlaySubtle, borderWidth: 1, borderColor: themeColor().coralText },
    closedText: { fontSize: 15, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().coralText },
    adminNotes: { padding: 14, borderRadius: radius.card, backgroundColor: themeColor().card, borderWidth: 1, borderColor: themeColor().line, gap: 6 },
    adminNotesTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: themeColor().muted },
    adminNotesText: { fontSize: 14, fontFamily: "Inter_400Regular", color: themeColor().text, lineHeight: 20 },
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
