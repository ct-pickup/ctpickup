import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { siteOrigin } from "@/lib/env";
import { serviceRegionName } from "@/lib/serviceRegions";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useNavigation } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

function alertCaptainPayError(errMsg: string) {
  const lower = errMsg.toLowerCase();
  if (lower.includes("no_captain_claim")) {
    Alert.alert("", "You need to submit a captain claim first");
  } else if (lower.includes("already_confirmed")) {
    Alert.alert("", "Your payment is already confirmed");
  } else if (lower.includes("waiver_required")) {
    Alert.alert("", "Accept the waiver before paying");
  } else if (lower.includes("claim_expired")) {
    Alert.alert("", "Your claim expired — submit a new one");
  } else {
    Alert.alert("", errMsg);
  }
}

export default function FieldTournamentDetailScreen() {
  const navigation = useNavigation();
  const { region } = useSelectedRegion();
  const { session } = useAuth();
  const { loading, error, payload } = useFieldTournament();
  const [payBusy, setPayBusy] = useState(false);

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>HUB · {serviceRegionName(region)}</Text>
      <Text style={styles.lead}>
        Outdoor bracket hub for this state — team counts and announcements match what staff publish online. Captain claims
        and roster slots follow tournament rules on the server.
      </Text>

      <FieldTournamentCard loading={loading} error={error} payload={payload} style={{ marginTop: 8 }} />

      {payload?.tournament ? (
        session ? (
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
              <Text style={styles.captainPayBtnText}>Pay captain fee — $250</Text>
            )}
          </Pressable>
        ) : (
          <Text style={styles.signInToPay}>Sign in to pay</Text>
        )
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
    marginTop: 16,
    width: "100%",
    alignSelf: "stretch",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#a3e635",
    alignItems: "center",
    justifyContent: "center",
  },
  captainPayBtnDisabled: { opacity: 0.45 },
  captainPayBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  signInToPay: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
  },
});
