import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SCORE_MAX } from "@/lib/pickup/resultOutcome";
import { scorePreview, type ResultFormState } from "@/lib/resultForm";
import { headline, radius, themeColor, useThemedStyles } from "@/theme";

type Pick = NonNullable<ResultFormState["pick"]>;

/**
 * Final score (Team A and Team B, 0–30) with a "Didn't track the score" fallback to a winner picker.
 * Without `scoresAvailable` (migration not run yet) only the winner picker shows, with no draw choice.
 */
export function ResultScoreFields({
  value,
  onChange,
  scoresAvailable,
  teams = ["A", "B"],
  disabled = false,
}: {
  value: ResultFormState;
  onChange: (next: ResultFormState) => void;
  scoresAvailable: boolean;
  teams?: Array<"A" | "B" | "C">;
  disabled?: boolean;
}) {
  useThemedStyles(publish_styles);
  const twoTeams = teams.length === 2;
  const showScores = scoresAvailable && twoTeams && value.tracked;
  const picks: Pick[] = scoresAvailable && twoTeams ? [...teams, "draw"] : teams;
  const preview = showScores ? scorePreview(value) : null;

  const setScore = (key: "scoreA" | "scoreB", raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 2);
    const n = digits === "" ? null : Number(digits);
    onChange({ ...value, [key]: n != null && n > SCORE_MAX ? String(SCORE_MAX) : digits });
  };

  return (
    <View style={styles.root}>
      {showScores ? (
        <>
          <Text style={styles.label}>Final score</Text>
          <View style={styles.scoreRow}>
            {(["scoreA", "scoreB"] as const).map((key, i) => (
              <View key={key} style={styles.scoreBox}>
                <Text style={styles.teamLabel}>Team {i === 0 ? "A" : "B"}</Text>
                <TextInput
                  value={value[key]}
                  onChangeText={(t) => setScore(key, t)}
                  editable={!disabled}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="0"
                  placeholderTextColor={themeColor().muted}
                  accessibilityLabel={`Team ${i === 0 ? "A" : "B"} score, 0 to ${SCORE_MAX}`}
                  style={styles.scoreInput}
                />
              </View>
            ))}
          </View>
          <Text style={styles.hint}>{preview ?? `Scores from 0 to ${SCORE_MAX}. The higher score wins; equal is a draw.`}</Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>Who won?</Text>
          <View style={styles.pickRow}>
            {picks.map((p) => {
              const selected = value.pick === p;
              return (
                <Pressable
                  key={p}
                  disabled={disabled}
                  onPress={() => onChange({ ...value, pick: p })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.pick, selected && styles.pickSelected]}
                >
                  <Text style={[styles.pickText, selected && styles.pickTextSelected]}>{p === "draw" ? "Draw" : `Team ${p}`}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {scoresAvailable && twoTeams ? (
        <Pressable
          disabled={disabled}
          onPress={() => onChange({ ...value, tracked: !value.tracked })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !value.tracked }}
          style={styles.toggleRow}
        >
          <View style={[styles.checkbox, !value.tracked && styles.checkboxOn]} />
          <Text style={styles.toggleText}>Didn&apos;t track the score</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    root: { gap: 8 },
    label: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    scoreRow: { flexDirection: "row", gap: 12 },
    scoreBox: {
      flex: 1,
      alignItems: "center",
      gap: 4,
      paddingVertical: 12,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: themeColor().line,
      backgroundColor: themeColor().card,
    },
    teamLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: themeColor().muted },
    scoreInput: { minWidth: 64, textAlign: "center", fontSize: 36, ...headline, color: themeColor().text },
    hint: { fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().muted },
    pickRow: { flexDirection: "row", gap: 8 },
    pick: {
      flex: 1,
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: radius.button,
      borderWidth: 2,
      borderColor: themeColor().overlay,
    },
    pickSelected: { borderColor: themeColor().pitchText, backgroundColor: themeColor().pitch },
    pickText: { fontSize: 17, ...headline, color: themeColor().text },
    pickTextSelected: { color: themeColor().onPitch },
    toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: themeColor().muted },
    checkboxOn: { backgroundColor: themeColor().pitch, borderColor: themeColor().pitchText },
    toggleText: { fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
