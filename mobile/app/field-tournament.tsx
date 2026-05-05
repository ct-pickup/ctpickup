import { CaptainClaimModal } from "@/components/CaptainClaimModal";
import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { siteOrigin } from "@/lib/env";
import { serviceRegionName } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

const ACTIVE_CLAIM_STATUSES = [
  "claim_submitted",
  "payment_pending",
  "captain_not_verified",
  "roster_pending",
  "verification_in_progress",
] as const;

function alertCaptainPayError(errMsg: string) {
  const lower = errMsg.toLowerCase();
  if (lower.includes("no_captain_claim")) {
    Alert.alert("", "You need to submit a captain claim first");
  } else if (lower.includes("already_confirmed")) {
    Alert.alert("", "Your payment is already confirmed");
  } else if (lower.includes("waiver_required")) {
    Alert.alert("", "Accept the waiver before paying");
  } else if (lower.includes("claim_expired")) {
    Alert.alert("", "Your claim expired submit a new one");
  } else {
    Alert.alert("", errMsg);
  }
}

export default function FieldTournamentDetailScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { region } = useSelectedRegion();
  const { session, supabase } = useAuth();
  const { loading, error, payload, reload } = useFieldTournament();
  const [payBusy, setPayBusy] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [hasClaim, setHasClaim] = useState(false);

  async function handleCaptainPay() {
    const token = session?.access_token;
    if (!token) return;
    const base = siteOrigin();
    if (!base) {
      Alert.alert("", "Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      return;
    }

    setPayBusy(true);
    try {
      const res = await fetch(`${base}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!res.ok) {
        Alert.alert("Payment error", `Status ${res.status}: ${JSON.stringify(data)}`);
        return;
      }

      if (res.ok && typeof data.url === "string" && data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        return;
      }

      const errMsg =
        typeof data.error === "string" && data.error.trim()
          ? data.error.trim()
          : `Could not start checkout (${res.status}).`;
      alertCaptainPayError(errMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error.";
      Alert.alert("", msg);
    } finally {
      setPayBusy(false);
    }
  }

  useEffect(() => {
    navigation.setOptions?.({
      title: "In-person tournament",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: "#0a0a0a",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
      },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  const t = payload?.tournament;

  useEffect(() => {
    if (t?.title) {
      navigation.setOptions?.({ title: String(t.title).slice(0, 42) });
    }
  }, [navigation, t?.title]);

  const tournamentId = t?.id ?? null;
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!supabase || !tournamentId || !userId) {
      setHasClaim(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("tournament_captains")
        .select("id, status")
        .eq("tournament_id", tournamentId)
        .eq("user_id", userId)
        .in("status", ACTIVE_CLAIM_STATUSES as unknown as string[])
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setHasClaim(false);
        return;
      }
      setHasClaim(!!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, tournamentId, userId, payload]);

  const claimedTeams = payload?.claimedTeams ?? 0;
  const maxTeams = t?.maxTeams ?? 0;
  const spotsRemaining = Math.max(0, maxTeams - claimedTeams);
  const slotsFull = !!t && (spotsRemaining <= 0 || !!payload?.full);
  const claimDisabled = !t || slotsFull;

  function openClaimModal() {
    if (!session) {
      Alert.alert("", "Sign in to claim a captain spot.");
      return;
    }
    if (claimDisabled) return;
    setClaimModalOpen(true);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>HUB · {serviceRegionName(region)}</Text>
      <Text style={styles.lead}>
        Outdoor bracket hub for this state team counts and announcements match what staff publish online. Captain claims
        and roster slots follow tournament rules on the server.
      </Text>

      <FieldTournamentCard loading={loading} error={error} payload={payload} style={{ marginTop: 8 }} />

      <Pressable
        style={({ pressed }) => [styles.statusLinkRow, pressed && { opacity: 0.9 }]}
        onPress={() => (router.push as (href: string) => void)("/tournament-status")}
        accessibilityRole="button"
        accessibilityLabel="Tournament status"
      >
        <View style={styles.statusLinkLeft}>
          <View style={styles.statusLinkIconWrap}>
            <FontAwesome name="trophy" size={16} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.statusLinkText}>Tournament status</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
      </Pressable>

      {t ? (
        <View style={styles.statsRow}>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>Minimum to confirm</Text>
            <Text style={styles.chipValue}>{t.officialThreshold || "—"}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>Teams claimed</Text>
            <Text style={styles.chipValue}>
              {claimedTeams} / {maxTeams || "—"}
            </Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>Spots remaining</Text>
            <Text style={styles.chipValue}>{spotsRemaining}</Text>
          </View>
        </View>
      ) : null}

      {t ? (
        <>
          <Pressable
            style={[styles.claimBtn, claimDisabled && styles.claimBtnDisabled]}
            disabled={claimDisabled}
            onPress={openClaimModal}
            accessibilityRole="button"
            accessibilityLabel="Claim a team"
          >
            <Text style={styles.claimBtnText}>Claim a team</Text>
          </Pressable>
          {slotsFull ? (
            <Text style={styles.claimSubText}>Captain slots are full.</Text>
          ) : !session ? (
            <Text style={styles.claimSubText}>Sign in to submit a captain claim.</Text>
          ) : null}
        </>
      ) : null}

      {t && session && hasClaim ? (
        <Pressable
          style={[styles.captainPayBtn, payBusy && styles.captainPayBtnDisabled]}
          disabled={payBusy}
          onPress={() => void handleCaptainPay()}
          accessibilityRole="button"
          accessibilityLabel="Pay captain fee"
        >
          {payBusy ? (
            <ActivityIndicator color="#111" />
          ) : (
            <Text style={styles.captainPayBtnText}>Pay captain fee $250</Text>
          )}
        </Pressable>
      ) : null}

      {payload?.tournament && payload.tournament.announcement ? (
        <View style={styles.note}>
          <FontAwesome name="bullhorn" size={16} color="rgba(163,230,53,0.85)" />
          <Text style={styles.noteText}>{payload.tournament.announcement}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About this bracket</Text>
        <Text style={styles.body}>
          This screen is only for the in-person captain bracket. Online EA FC events are listed under the Tournaments tab.
          When staff post updates above, they appear here too.
        </Text>
      </View>

      <CaptainClaimModal
        visible={claimModalOpen}
        accessToken={session?.access_token ?? null}
        payBusy={payBusy}
        onClose={() => setClaimModalOpen(false)}
        onClaimRecorded={() => void reload()}
        onProceedToPay={handleCaptainPay}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.65)",
  },
  lead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.58)",
  },
  statusLinkRow: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLinkLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusLinkIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(163,230,53,0.08)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  statusLinkText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.9)" },
  statsRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.55)",
    textTransform: "uppercase",
  },
  chipValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
  },
  claimBtn: {
    marginTop: 14,
    width: "100%",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  claimBtnDisabled: { opacity: 0.45 },
  claimBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  claimSubText: {
    marginTop: 8,
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
  },
  note: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.22)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.78)" },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  body: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.62)",
  },
  captainPayBtn: {
    marginTop: 12,
    width: "100%",
    alignSelf: "stretch",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  captainPayBtnDisabled: { opacity: 0.45 },
  captainPayBtnText: { color: LIME, fontWeight: "800", fontSize: 15 },
});
