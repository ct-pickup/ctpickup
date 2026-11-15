import { StyleSheet, View } from "react-native";

import { TournamentEntryCard, useOpenTournamentBracket } from "@/components/tournament/TournamentEntryCard";
import { useTournamentList } from "@/hooks/useTournamentList";
import { homeTournament } from "@/lib/tournamentEntryCore";

/**
 * The Home card under the date strip. Shows one tournament, and only while one is under way or starts within 7 days.
 * Renders nothing otherwise, and takes no space.
 */
export function HomeTournamentCard() {
  const { items, now } = useTournamentList();
  const open = useOpenTournamentBracket();
  const t = homeTournament(items, now);
  if (!t) return null;
  return (
    <View style={styles.wrap}>
      <TournamentEntryCard item={t} now={now} onPress={() => open(t.id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
});
