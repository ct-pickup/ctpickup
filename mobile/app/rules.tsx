import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#0a0a0a";
const LIME = "#a3e635";

type Rule = {
  number: number;
  title: string;
  body: string;
};

const RULES: Rule[] = [
  {
    number: 1,
    title: "Respect Comes First",
    body:
      "Everyone here is part of the same community. Treat players, organizers, and staff with respect at all times. Disrespect, hostility, or aggression toward anyone on or off the pitch will not be tolerated.",
  },
  {
    number: 2,
    title: "Community Over Competition",
    body:
      "We compete hard, but we never lose sight of why we're here. CT Pickup is built on connection, growth, and shared love for the game. The community comes first; the result comes second.",
  },
  {
    number: 3,
    title: "High Intensity Is Required",
    body:
      "Every player is expected to bring full effort and commitment. CT Pickup is not a casual kickaround. If you're not ready to compete at a high level, this isn't the right environment for you.",
  },
  {
    number: 4,
    title: "No Slide Tackles",
    body:
      "Slide tackles are strictly prohibited. They put other players at risk and have no place at our pickups. Any slide tackle results in an immediate warning, and repeat offenses can result in removal from the session.",
  },
  {
    number: 5,
    title: "No Referees, No Official Jerseys",
    body:
      "Pickups are self-officiated. There are no referees, and no team jerseys are required or allowed. Be honest, fair, and call your own game with maturity.",
  },
  {
    number: 6,
    title: "Be On Time and Ready",
    body:
      "Arrive at least 10 minutes before the scheduled start. Late arrivals delay everyone and may forfeit their spot. Come warmed up, hydrated, and ready to play.",
  },
  {
    number: 7,
    title: "No Spot Holding",
    body:
      "Spots are personal and non-transferable. You cannot reserve, save, or hold a spot for anyone else. Each player must register and confirm their own attendance through the app.",
  },
  {
    number: 8,
    title: "No Offsides",
    body:
      "Offsides are not enforced at CT Pickup. The game flows without stoppage so we can keep the pace high and play continuous, competitive football.",
  },
  {
    number: 9,
    title: "Ball Out of Bounds",
    body:
      "When the ball leaves the field of play, the opposing team restarts from the touchline. Restarts must be quick to keep the rhythm of the game alive.",
  },
  {
    number: 10,
    title: "Kick-Ins, Not Throw-Ins",
    body:
      "All restarts from the sideline are taken with the feet, not by hand. The ball must be stationary before the kick-in, and opposing players must give at least 2 yards of space.",
  },
  {
    number: 11,
    title: "Game Time",
    body:
      "Each game is played to a set score or time as decided by staff before the session. Once the result is confirmed, teams rotate quickly so everyone gets equal play time.",
  },
  {
    number: 12,
    title: "No-Shows and Refunds",
    body:
      "Confirmed players who do not show up forfeit their spot and their fee. Cancellations more than 24 hours before the run start are eligible for a refund; cancellations within 24 hours of the start time are not refunded.",
  },
  {
    number: 13,
    title: "Follow Staff Decisions",
    body:
      "CT Pickup staff have the final say on all matters during a session — team balance, conduct, eligibility, and discipline. Disagreements should be handled respectfully, and staff decisions are final.",
  },
  {
    number: 14,
    title: "Protect the Standard",
    body:
      "CT Pickup exists to maintain a high standard of play, attitude, and respect. Anyone who threatens that standard — through poor sportsmanship, dangerous play, or disregard for the rules — will be removed.",
  },
  {
    number: 15,
    title: "Come to Compete, Come to Contribute",
    body:
      "Every player is expected to add to the environment, not take from it. Compete with intensity, communicate with teammates, and lift the level of those around you.",
  },
  {
    number: 16,
    title: "Eligibility, Age, and Participation",
    body:
      "All participants must be at least 13 years old. Players under 18 must have parental or guardian consent. Each participant must complete the CT Pickup waiver before stepping onto the pitch.",
  },
  {
    number: 17,
    title: "Eligibility and Accountability",
    body:
      "By participating, you confirm that you've read and agree to all CT Pickup rules and the Liability Waiver & Participation Agreement. Repeated violations of any rule may result in suspension or permanent removal from the platform.",
  },
];

export default function RulesScreen() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 16) + 24;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.docTitle}>CT Pickup Rules</Text>
        <Text style={styles.docSubtitle}>
          The standard we play by. Read them. Live them. Protect them.
        </Text>

        <View style={styles.list}>
          {RULES.map((rule) => (
            <View key={rule.number} style={styles.card}>
              <Text style={styles.cardTitle}>
                {rule.number}. {rule.title}
              </Text>
              <Text style={styles.cardBody}>{rule.body}</Text>
            </View>
          ))}
        </View>

        <View style={styles.closing}>
          <Text style={styles.closingTitle}>Our Standard</Text>
          <Text style={styles.closingBody}>Compete hard. Respect everyone. Protect the level.</Text>
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
  closing: {
    marginTop: 28,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.08)",
  },
  closingTitle: {
    color: LIME,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  closingBody: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
