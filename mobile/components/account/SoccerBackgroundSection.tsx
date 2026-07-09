import { View, Text, Pressable, Linking } from "react-native";
import { accountStyles as styles, LIME } from "./accountStyles";
import FontAwesome from "@expo/vector-icons/FontAwesome";

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

const VERIFICATION_COLORS: Record<string, string> = {
  self: "rgba(255,255,255,0.35)",
  document: "#a3e635",
  vouched: "#a3e635",
};

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
  const age = ageFromDob(dateOfBirth);
  const hasAny = primaryPosition || experienceLevel || clubName || age;
  if (!hasAny) return null;

  const verif = verificationLevel ?? "self";
  const verifLabel = VERIFICATION_LABELS[verif] ?? "Self-declared";
  const verifColor = VERIFICATION_COLORS[verif] ?? "rgba(255,255,255,0.35)";

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
              <Text style={[styles.bgValue, { color: LIME, textDecorationLine: "underline" }]}>
                View roster ↗
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.bgRow, { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }]}>
          <Text style={styles.bgLabel}>Verification</Text>
          <Text style={[styles.bgValue, { color: verifColor }]}>
            {verif !== "self" ? "✓ " : ""}{verifLabel}
          </Text>
        </View>

        {verif === "self" && onSubmitVerification ? (
          <Pressable
            onPress={onSubmitVerification}
            style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.75 }, { marginTop: 12 }]}
          >
            <Text style={styles.ghostBtnText}>Submit for verification →</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
