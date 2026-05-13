import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";

const SUPPORT_EMAIL = "pickupct@gmail.com";

type TermSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

const TERMS_SECTIONS: TermSection[] = [
  {
    title: "1. Acceptance of Terms",
    paragraphs: [
      "By downloading, accessing, or using CT Pickup you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the platform.",
    ],
  },
  {
    title: "2. Intellectual Property",
    paragraphs: [
      "CT Pickup, including its name, logo, design, source code, software, content, features, and functionality are the exclusive intellectual property of CT Pickup and its founders and are protected by applicable intellectual property laws. All rights reserved. Unauthorized use of any part of the platform is strictly prohibited.",
    ],
  },
  {
    title: "3. Prohibited Activities",
    paragraphs: ["Users may not:"],
    bullets: [
      "Copy, reproduce, distribute, or create derivative works based on CT Pickup or any part of it",
      "Reverse engineer, decompile, disassemble, or attempt to extract the source code of the app",
      "Use automated tools, bots, or scrapers to access any part of the platform",
      "Use any information or insights gained from using CT Pickup to build, assist, or advise any competing product or service",
      "Access the platform through unauthorized means or attempt to bypass any security measures",
      "Impersonate any person or entity or misrepresent your affiliation with any person or entity",
    ],
  },
  {
    title: "4. User Content",
    paragraphs: [
      "By posting messages or content on CT Pickup you grant CT Pickup a non-exclusive license to display your content within the platform. You retain ownership of your content. You are solely responsible for any content you post.",
    ],
  },
  {
    title: "5. Code of Conduct",
    paragraphs: [
      "Users must treat all other players and staff with respect. CT Pickup reserves the right to suspend or permanently ban any user for harassment, abusive behavior, unsportsmanlike conduct, or any violation of these terms.",
    ],
  },
  {
    title: "6. Payments and Refunds",
    paragraphs: [
      "All pickup run and tournament fees are processed securely through Stripe. Refund eligibility is determined by the cancellation policy displayed at the time of payment. CT Pickup reserves the right to modify pricing at any time.",
    ],
  },
  {
    title: "7. Assumption of Risk",
    paragraphs: [
      "Participation in CT Pickup pickup runs and tournaments involves physical activity and inherent risk of injury. By participating you acknowledge and accept these risks. CT Pickup is not responsible for any injuries, losses, or damages that occur during or in connection with any event.",
    ],
  },
  {
    title: "8. Termination",
    paragraphs: [
      "CT Pickup reserves the right to suspend or terminate any account at any time, with or without notice, for violation of these terms or for any other reason at our sole discretion.",
    ],
  },
  {
    title: "9. Disclaimer of Warranties",
    paragraphs: [
      "CT Pickup is provided as-is and as-available without warranties of any kind, either express or implied. We do not guarantee that the platform will be uninterrupted, error-free, or free of harmful components.",
    ],
  },
  {
    title: "10. Limitation of Liability",
    paragraphs: [
      "To the fullest extent permitted by law, CT Pickup and its founders shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the platform.",
    ],
  },
  {
    title: "11. Governing Law",
    paragraphs: [
      "These terms are governed by and construed in accordance with the laws of the State of Connecticut, United States, without regard to its conflict of law provisions.",
    ],
  },
  {
    title: "12. Changes to Terms",
    paragraphs: [
      "We reserve the right to update these terms at any time. Continued use of the platform after changes constitutes acceptance of the new terms. We will notify users of material changes through the app.",
    ],
  },
  {
    title: "13. Contact",
    paragraphs: [`For questions about these terms contact us at: ${SUPPORT_EMAIL}`],
  },
];

export default function TermsOfServiceScreen() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 16) + 24;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.docTitle}>Terms of Service</Text>
        <Text style={styles.docSubtitle}>
          Rules and conditions for using the CT Pickup platform.
        </Text>

        <View style={styles.list}>
          {TERMS_SECTIONS.map((s) => (
            <View key={s.title} style={styles.card}>
              <Text style={styles.cardTitle}>{s.title}</Text>
              {s.paragraphs?.map((p, i) => (
                <Text
                  key={`${s.title}-p-${i}`}
                  style={[styles.cardBody, i > 0 ? styles.paragraphGap : null]}
                >
                  {p}
                </Text>
              ))}
              {s.bullets?.map((b, i) => (
                <Text key={`${s.title}-b-${i}`} style={[styles.cardBody, styles.bulletLine]}>
                  • {b}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
  docTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  docSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  list: { gap: 12 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  cardBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 21,
  },
  paragraphGap: {
    marginTop: 10,
  },
  bulletLine: {
    marginTop: 8,
  },
});
