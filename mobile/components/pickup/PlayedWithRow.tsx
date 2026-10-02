import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AvatarStack } from "@/components/PlayerAvatar";
import { useAuth } from "@/context/AuthContext";
import { fetchPlayedWith, playedWithLine, type PlayedWithSummary } from "@/lib/matchApi";
import { themeColor, useThemedStyles } from "@/theme";

const EMPTY: Record<string, PlayedWithSummary> = {};

/** Batch-loads played-with summaries for the given runs. Fixture ids (dev preview) are skipped. */
export function usePlayedWith(runIds: string[], opts?: { skip?: boolean; reloadKey?: unknown }) {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const key = useMemo(() => Array.from(new Set(runIds.filter(Boolean))).sort().join(","), [runIds]);
  const [state, setState] = useState<{ key: string; byRun: Record<string, PlayedWithSummary>; error: string | null }>({
    key: "",
    byRun: {},
    error: null,
  });
  const active = opts?.skip !== true && Boolean(token) && Boolean(key);
  const reloadKey = opts?.reloadKey;

  useEffect(() => {
    if (!active || !token) return;
    let cancelled = false;
    void fetchPlayedWith(token, key.split(",")).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({ key, byRun: res.data, error: null });
      } else {
        console.warn("[played-with] load failed:", res.error);
        setState({ key, byRun: {}, error: res.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, key, token, reloadKey]);

  const current = active && state.key === key;
  return { byRun: current ? state.byRun : EMPTY, error: current ? state.error : null };
}

/** Avatar stack plus "Jude, Dylan + 2 you've played with". Renders nothing when nobody qualifies. */
export default function PlayedWithRow({
  summary,
  size = 24,
  style,
}: {
  summary: PlayedWithSummary | null | undefined;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  useThemedStyles(publish_styles);
  const line = summary ? playedWithLine(summary) : null;
  if (!summary || !line) return null;
  const people = summary.people.map((p, i) => ({
    user_id: `played-with-${i}`,
    first_name: p.first_name,
    last_name: null,
    avatar_url: p.avatar_url,
  }));
  return (
    <View style={[styles.row, style]} accessibilityLabel={line}>
      <AvatarStack people={people} total={summary.count} max={3} size={size} />
      <Text style={styles.text} numberOfLines={1}>
        {line}
      </Text>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    text: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().pitchText },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
