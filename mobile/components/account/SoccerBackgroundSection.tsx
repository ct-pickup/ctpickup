import { View, Text, Pressable, Linking } from "react-native";
import { accountStyles as styles, publish_accountStyles } from "./accountStyles";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { themeColor, useThemedStyles } from "@/theme";
const EXPERIENCE_LABELS: Record<string, string> = {
  recreational: "Recreational",
  club: "Club",
  hs_varsity: "High School Varsity",
  college: "College",
  semi_pro: "Semi-Pro",
  pro: "Pro",
};

const VERIFICATION_LABELS: Record<string, string> = {
  self: "Self-declared",
  document: "Document verified",
  vouched: "Vouched",
};

function VERIFICATION_COLORS(): Record<string, string> {
  return {
  self: themeColor().overlayStrong,
  document: themeColor().pitch,
  vouched: themeColor().pitch,
};
}

type Props = {
  primaryPosition: string | null;
  secondaryPositions: string[] | null;
  experienceLevel: string | null;
  dateOfBirth: string | null;
  clubName: string | null;
  rosterUrl: string | null;
  verificationLevel?: string | null;
  onSubmitVerification?: () => void;
};

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age > 0 && age < 100 ? age : null;
}

export function SoccerBackgroundSection({
  primaryPosition,
  secondaryPositions,
  experienceLevel,
  dateOfBirth,
  clubName,
  rosterUrl,
  verificationLevel,
  onSubmitVerification,
}: Props) {
  useThemedStyles(publish_accountStyles);

  const age = ageFromDob(dateOfBirth);
  const hasAny = primaryPosition || experienceLevel || clubName || age;
  if (!hasAny) return null;

  const verif = verificationLevel ?? "self";
  const verifLabel = VERIFICATION_LABELS[verif] ?? "Self-declared";
  const verifColor = VERIFICATION_COLORS()[verif] ?? themeColor().overlayStrong;

  return (
    <>
      <Text style={styles.sectionTitle}>Soccer Background</Text>
      <View style={styles.card}>
        {primaryPosition ? (
          <View style={styles.bgRow}>
            <Text style={styles.bgLabel}>Position</Text>
            <Text style={styles.bgValue}>
              {primaryPosition}
              {secondaryPositions && secondaryPositions.length > 0
                ? ` · ${secondaryPositions.join(" · ")}`
                : ""}
            </Text>
          </View>
        ) : null}
        {experienceLevel ? (
          <View style={styles.bgRow}>
            <Text style={styles.bgLabel}>Level</Text>
            <Text style={styles.bgValue}>{EXPERIENCE_LABELS[experienceLevel] ?? experienceLevel}</Text>
          </View>
        ) : null}
        {age ? (
          <View style={styles.bgRow}>
            <Text style={styles.bgLabel}>Age</Text>
            <Text style={styles.bgValue}>{age}</Text>
          </View>
        ) : null}
        {clubName ? (
          <View style={styles.bgRow}>
            <Text style={styles.bgLabel}>Club</Text>
            <Text style={styles.bgValue}>{clubName}</Text>
          </View>
        ) : null}
        {rosterUrl ? (
          <View style={styles.bgRow}>
            <Text style={styles.bgLabel}>Roster</Text>
            <Pressable onPress={() => Linking.openURL(rosterUrl)}>
              <Text style={[styles.bgValue, { color: themeColor().pitchText, textDecorationLine: "underline" }]}>
                View roster ↗
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.bgRow, { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: themeColor().line }]}>
          <Text style={styles.bgLabel}>Verification</Text>
          <Text style={[styles.bgValue, { color: verifColor }]}>
            {verif !== "self" ? "✓ " : ""}{verifLabel}
          </Text>
        </View>


      </View>
      {verif === "self" && onSubmitVerification ? (
        <View style={{
          marginTop: 16,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: themeColor().line,
          backgroundColor: themeColor().card,
          padding: 16,
          gap: 8,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: themeColor().muted }} />
            <Text style={{ color: themeColor().text, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold",}}>
              NOT VERIFIED
            </Text>
          </View>
          <Text style={{ color: themeColor().muted, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
            Self-declared players are capped at Gold tier. Get verified to unlock Platinum and Diamond.
          </Text>
          <Pressable
            onPress={onSubmitVerification}
            style={({ pressed }) => [{
              backgroundColor: themeColor().pitch,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: "center",
              marginTop: 4,
              opacity: pressed ? 0.85 : 1,
            }]}
          >
            <Text style={{ color: themeColor().onPitch, fontWeight: "800", fontSize: 16, fontFamily: "Inter_700Bold",}}>
              Submit for Verification →
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
