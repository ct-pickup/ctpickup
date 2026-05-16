import * as zipcodes from "zipcodes";
import { StyleSheet, Text, View } from "react-native";

const LIME = "#a3e635";

export type PlayerByVenueRow = { venue: string; count: number };
export type PlayerByZipRow = { zip_code: string; count: number };

function zipLineLabel(zip: string): string {
  const trimmed = String(zip || "").trim();
  if (!trimmed) return "—";
  try {
    const info = zipcodes.lookup(trimmed) as { city?: string; state?: string } | undefined;
    if (info?.city && info?.state) return `${trimmed} · ${info.city}, ${info.state}`;
  } catch {
    /* ignore */
  }
  return trimmed;
}

function DistributionRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.max(0.06, Math.min(1, count / max)) : 0;
  return (
    <View style={styles.distRow}>
      <Text style={styles.distLabel} numberOfLines={2}>
        {label}
      </Text>
      <View style={styles.distMid}>
        <View style={styles.distTrack}>
          <View style={[styles.distFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>
      <Text style={styles.distCount}>{count}</Text>
    </View>
  );
}

export function PlayerLocationBreakdown({
  playersByVenue,
  playersByZip,
}: {
  playersByVenue: PlayerByVenueRow[];
  playersByZip: PlayerByZipRow[];
}) {
  const maxVenue = playersByVenue.length ? Math.max(...playersByVenue.map((r) => r.count)) : 0;
  const maxZip = playersByZip.length ? Math.max(...playersByZip.map((r) => r.count)) : 0;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Players by Location</Text>
        <Text style={styles.cardHint}>Players with a nearest venue set (all accounts).</Text>
        {playersByVenue.length === 0 ? (
          <Text style={styles.muted}>No venue data yet.</Text>
        ) : (
          playersByVenue.map((row) => (
            <DistributionRow key={row.venue} label={row.venue} count={row.count} max={maxVenue || 1} />
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Zip codes</Text>
        <Text style={styles.cardHint}>Top 10 by player count (5-digit ZIP, all accounts).</Text>
        {playersByZip.length === 0 ? (
          <Text style={styles.muted}>No ZIP data yet.</Text>
        ) : (
          playersByZip.map((row) => (
            <DistributionRow
              key={row.zip_code}
              label={zipLineLabel(row.zip_code)}
              count={row.count}
              max={maxZip || 1}
            />
          ))
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
  cardHint: {
    marginTop: 6,
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  muted: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontSize: 14 },
  distRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  distLabel: {
    flex: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    fontWeight: "700",
  },
  distMid: {
    width: 72,
    flexShrink: 0,
  },
  distTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  distFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(163,230,53,0.35)",
  },
  distCount: {
    flexShrink: 0,
    minWidth: 32,
    textAlign: "right",
    color: LIME,
    fontSize: 14,
    fontWeight: "900",
  },
});
