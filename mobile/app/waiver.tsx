import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import { siteOrigin } from "@/lib/env";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";
const WAIVER_VERSION = "v1.5";

export default function WaiverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isReady } = useAuth();
  const { refreshWaiver } = useWaiver();
  const [submitting, setSubmitting] = useState(false);

  const baseUrl = siteOrigin();

  const openUrl = useCallback(
    (path: string) => {
      if (!baseUrl) return;
      void Linking.openURL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    },
    [baseUrl],
  );

  const onAccept = useCallback(async () => {
    const origin = siteOrigin();
    const token = session?.access_token;
    if (!origin) {
      Alert.alert("Configuration error", "Set EXPO_PUBLIC_SITE_URL in mobile/.env to your deployed site URL.");
      return;
    }
    if (!token) {
      Alert.alert("Session expired", "Please sign in again.");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch(`${origin}/api/waiver/accept`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ acknowledge: true }),
        cache: "no-store",
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!r.ok) {
        const msg =
          (j && typeof j === "object" && typeof j.error === "string" && j.error.trim()
            ? j.error.trim()
            : null) ||
          (j && typeof j === "object" && typeof j.message === "string" && j.message.trim()
            ? j.message.trim()
            : null) ||
          `Could not accept waiver (HTTP ${r.status}).`;
        Alert.alert("Something went wrong", msg);
        return;
      }
      await refreshWaiver();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Network error", msg || "Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [refreshWaiver, router, session?.access_token]);

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  const bottomPad = Math.max(insets.bottom, 12) + 72;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 16), paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <Image
            source={require("../assets/images/ct-pickup-wordmark.png")}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityLabel="CT Pickup"
          />
        </View>
        <Text style={styles.docTitle}>Liability Waiver & Participation Agreement</Text>
        <Text style={styles.version}>Version {WAIVER_VERSION}</Text>

        <View style={styles.section}>
          <Text style={styles.h2}>1. Assumption of Risk</Text>
          <Text style={styles.p}>
            You understand that participation in soccer and association football activities including pickup games,
            scrimmages, informal matches, tournaments, training, and related athletic events involves inherent risks.
            These risks include, but are not limited to, physical injury, illness, collisions with other participants,
            and unforeseen hazards.
          </Text>
          <Text style={styles.p}>
            You voluntarily assume all risks associated with participation, whether known or unknown, and accept full
            responsibility for your involvement.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>2. Release of Liability</Text>
          <Text style={styles.p}>
            To the fullest extent permitted by law, you release and hold harmless CT Pickup, its operators,
            organizers, and affiliates from any and all claims, liabilities, damages, or expenses arising out of or
            related to your participation in any platform-related activities.
          </Text>
          <Text style={styles.p}>
            This includes, but is not limited to, injuries, losses, or damages occurring during or in connection with
            pickup games, tournaments, training sessions, or any other activities connected to the platform.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>3. Platform Role Clarification</Text>
          <Text style={styles.p}>
            CT Pickup provides tools for coordination, connection, and guidance. It does not organize, supervise, or
            control all activities that may occur between users.
          </Text>
          <Text style={styles.p}>
            Participants are responsible for their own safety, conduct, and decisions when engaging in any activities
            arranged through or associated with the platform.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>4. No Professional Services</Text>
          <Text style={styles.p}>
            Any guidance, advice, or feedback provided through the platform is based on personal experience and is not
            professional, certified, or licensed instruction.
          </Text>
          <Text style={styles.p}>
            You acknowledge that no professional coaching, medical, or training services are being provided.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>5. Scope of Coverage</Text>
          <Text style={styles.p}>
            This agreement applies to all use of the platform and all activities connected to it, including but not
            limited to pickup games, scrimmages, informal matches, tournaments, training, guidance, and any other
            interactions or events related to soccer or association football involving other users.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>6. No Guarantees</Text>
          <Text style={styles.p}>
            We do not guarantee outcomes, including but not limited to performance improvement, recruitment, or
            opportunities. All results depend on individual effort and external factors.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>7. User Responsibility</Text>
          <Text style={styles.p}>You are responsible for</Text>
          <Text style={styles.li}>• Scheduling and showing up for activities you commit to</Text>
          <Text style={styles.li}>• Submitting accurate results where reporting is required</Text>
          <Text style={styles.li}>• Maintaining appropriate conduct toward other participants</Text>
          <Text style={styles.li}>• Ensuring your own safety and environment while participating</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>8. Remote or Digital Participation</Text>
          <Text style={styles.p}>
            Some activities (for example, online tournaments or digital coordination) may be conducted remotely. You are
            responsible for your own equipment, internet connection, and environment when participating in those
            contexts.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>9. Additional Limitations</Text>
          <Text style={styles.p}>
            To the fullest extent permitted by law, CT Pickup and its operators shall not be liable for
          </Text>
          <Text style={styles.li}>• Loss of data or results</Text>
          <Text style={styles.li}>• Disputes between users</Text>
          <Text style={styles.li}>• Missed opportunities or outcomes unrelated to the releases above</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>10. Conduct & Fair Play</Text>
          <Text style={styles.p}>
            You agree to compete fairly, submit accurate results where applicable, and not engage in cheating,
            manipulation, or misconduct.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>11. Modifications</Text>
          <Text style={styles.p}>
            We reserve the right to update this agreement at any time. Continued use of the platform constitutes
            acceptance of any changes.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>12. Photo, Video, Audio & Public Use</Text>
          <Text style={styles.p}>
            Participation in pickup games, tournaments, training, events, or any other activities connected to CT Pickup
            is voluntary. If you participate, you give{" "}
            <Text style={styles.strong}>full, irrevocable consent</Text> for CT Pickup, its operators, organizers,
            volunteers, and anyone they authorize to photograph, film, livestream, and make audio or video recordings of
            you, and to capture your name, image, likeness, voice, and performance (your &quot;Appearance&quot;) in
            connection with those activities.
          </Text>
          <Text style={styles.p}>
            You grant CT Pickup a worldwide, royalty-free, perpetual license to use, reproduce, edit, distribute,
            publicly display, and publish your Appearance, in whole or in part, in any media now known or later
            developed including websites, social media, advertising, and promotional materials without further notice,
            approval, or compensation to you, except where prohibited by law.
          </Text>
          <Text style={styles.p}>
            You waive any right to inspect or approve finished materials where permitted by law, and you release CT
            Pickup and its operators from claims arising out of such use. This section is a non-negotiable condition of
            participation if you do not agree, you must not take part in CT Pickup activities.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>13. Eligibility & Acceptance</Text>
          <Text style={styles.p}>
            By using this platform, you confirm that you have read and agree to this Liability Waiver & Participation
            Agreement. You must be at least 13 years old to use this platform. If under 18, you confirm that you have
            parental or guardian consent.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>14. Payments & Prizes</Text>
          <Text style={styles.p}>
            Unless different terms apply to a specific product you accept at registration or checkout, all purchases are
            non-refundable unless otherwise stated.{" "}
            <Text style={styles.emphasis}>
              Tournament and pickup fees are generally non-refundable except as stated in the applicable refund policy:
              for in-person tournaments, refunds must be requested more than 48 hours before the tournament begins; for
              pickups, refunds are available if you cancel more than 24 hours before the run&apos;s scheduled start time.
              Full refund if the organizer cancels the run.
            </Text>{" "}
            Pickup fee details appear on{" "}
            <Text style={styles.link} onPress={() => openUrl("/pickup/how-it-works")}>
              How pickup works
            </Text>{" "}
            and the{" "}
            <Text style={styles.link} onPress={() => openUrl("/rules")}>
              CT Pickup Rules
            </Text>
            . Prizes are subject to verification and eligibility requirements.
          </Text>
        </View>

        <View style={[styles.section, { marginBottom: 8 }]}>
          <Text style={styles.h2}>15. No Affiliation</Text>
          <Text style={styles.p}>
            This platform is not affiliated with or endorsed by EA SPORTS or other third parties referenced only in
            connection with user-run activities.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          style={[styles.agreeBtn, submitting && styles.agreeBtnDisabled]}
          onPress={onAccept}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="I have read and agree to the Liability Waiver and Participation Agreement"
        >
          {submitting ? (
            <ActivityIndicator color="#0a0a0a" />
          ) : (
            <Text style={styles.agreeText}>I have read and agree to the Liability Waiver & Participation Agreement</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center" },
  scrollContent: { paddingHorizontal: 20 },
  brandRow: { alignItems: "center", marginBottom: 16 },
  wordmark: { width: 220, height: 48 },
  docTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 6,
  },
  version: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 24,
  },
  section: { marginBottom: 22 },
  h2: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 10 },
  p: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 10,
  },
  li: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 6,
    paddingLeft: 4,
  },
  strong: { color: "rgba(255,255,255,0.9)", fontWeight: "600" },
  emphasis: { color: "rgba(255,255,255,0.9)" },
  link: { color: LIME, textDecorationLine: "underline", fontSize: 14, lineHeight: 22 },
  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  agreeBtn: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  agreeBtnDisabled: { opacity: 0.7 },
  agreeText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
});
