import * as zipcodes from "zipcodes";
import { StyleSheet, Text, View } from "react-native";

import { themeColor, useThemedStyles } from "@/theme";
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
  useThemedStyles(publish_styles);

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
  useThemedStyles(publish_styles);

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

function make_styles() {
  return StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  cardTitle: { color: themeColor().text, fontWeight: "900", fontSize: 16, fontFamily: "Inter_700Bold" },
  cardHint: {
    marginTop: 6,
    color: themeColor().muted,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    lineHeight: 16,
  },
  muted: { marginTop: 10, color: themeColor().muted, fontSize: 14, fontFamily: "Inter_400Regular" },
  distRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  distLabel: {
    flex: 1,
    minWidth: 0,
    color: themeColor().text,
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  distMid: {
    width: 72,
    flexShrink: 0,
  },
  distTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: themeColor().overlay,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: themeColor().line,
  },
  distFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: themeColor().pitch,
  },
  distCount: {
    flexShrink: 0,
    minWidth: 32,
    textAlign: "right",
    color: themeColor().pitchText,
    fontSize: 14, fontFamily: "Inter_700Bold",
    fontWeight: "900",
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

