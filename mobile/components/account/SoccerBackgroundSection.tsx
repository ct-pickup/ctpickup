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


      </View>
      {verif === "self" && onSubmitVerification ? (
        <View style={{
          marginTop: 16,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.06)",
          padding: 16,
          gap: 8,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444" }} />
            <Text style={{ color: "#ef4444", fontWeight: "800", fontSize: 15, letterSpacing: 0.3 }}>
              NOT VERIFIED
            </Text>
          </View>
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18 }}>
            Self-declared players are capped at Gold tier. Get verified to unlock Platinum and Diamond.
          </Text>
          <Pressable
            onPress={onSubmitVerification}
            style={({ pressed }) => [{
              backgroundColor: "#ef4444",
              borderRadius: 10,
              paddingVertical: 13,
              alignItems: "center",
              marginTop: 4,
              opacity: pressed ? 0.85 : 1,
            }]}
          >
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.5 }}>
              Submit for Verification →
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
