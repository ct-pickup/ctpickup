import { StyleSheet, Text, View } from "react-native";

import { TournamentEntryCard, useOpenTournamentBracket } from "@/components/tournament/TournamentEntryCard";
import { useTournamentList } from "@/hooks/useTournamentList";
import { listedTournaments } from "@/lib/tournamentEntryCore";
import { themeColor, useThemedStyles } from "@/theme";

/** The "Tournaments" section at the top of the Events tab. Renders nothing when there is no tournament to show. */
export function TournamentsSection() {
  useThemedStyles(publish_styles);
  const { items, now } = useTournamentList();
  const open = useOpenTournamentBracket();
  const listed = listedTournaments(items, now);
  if (listed.length === 0) return null;
  return (
    <View style={styles.root} accessibilityLabel="Tournaments">
      <Text style={styles.title} accessibilityRole="header">
        Tournaments
      </Text>
      {listed.map((t) => (
        <TournamentEntryCard key={t.id} item={t} now={now} onPress={() => open(t.id)} />
      ))}
    </View>
  );
}

function make_styles() {
  const c = themeColor();
  return StyleSheet.create({
    root: { gap: 12 },
    title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.text },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
