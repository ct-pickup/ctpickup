import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import PlayerAvatar from "@/components/PlayerAvatar";
import { useAuth } from "@/context/AuthContext";
import { fetchFillCandidates, postMatchInvite, type FillCandidatesResult } from "@/lib/matchApi";
import { formatStars } from "@/lib/starRatings";
import { radius, themeColor, useThemedStyles } from "@/theme";

/**
 * Suggested players for a game the viewer hosts. `preview` (dev fixtures only)
 * skips the network and keeps invites local.
 */
export default function FillYourGameCard({ runId, preview }: { runId: string; preview?: FillCandidatesResult | null }) {
  useThemedStyles(publish_styles);
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [data, setData] = useState<FillCandidatesResult | null>(preview ?? null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    const request = token
      ? fetchFillCandidates(token, runId)
      : Promise.resolve({ ok: false as const, status: 401, error: "Sign in again to see suggested players." });
    void request.then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else {
        setData(null);
        setError(res.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [preview, token, runId, attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const limitReached = data != null && data.invites_sent >= data.invite_limit;

  async function invite(inviteToken: string) {
    if (!data || busyToken) return;
    setInviteError(null);
    const markInvited = (sent: number) =>
      setData((d) =>
        d
          ? {
              ...d,
              invites_sent: sent,
              candidates: d.candidates.map((c) => (c.invite_token === inviteToken ? { ...c, invited: true } : c)),
            }
          : d,
      );
    if (preview) {
      markInvited(data.invites_sent + 1);
      return;
    }
    if (!token) {
      setInviteError("Sign in again to send invites.");
      return;
    }
    setBusyToken(inviteToken);
    const res = await postMatchInvite(token, runId, inviteToken);
    setBusyToken(null);
    if (res.ok) {
      markInvited(res.data.invites_sent);
    } else {
      setInviteError(res.error);
      if (res.status === 429) setData((d) => (d ? { ...d, invites_sent: d.invite_limit } : d));
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Fill your game</Text>
      {loading ? (
        <ActivityIndicator color={themeColor().pitchText} style={styles.loading} />
      ) : error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.note}>{error}</Text>
          <Pressable onPress={retry} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      ) : !data || data.candidates.length === 0 ? (
        <Text style={styles.note}>No suggested players nearby right now.</Text>
      ) : (
        <>
          <Text style={styles.sub}>Players near you who fit this game.</Text>
          {data.candidates.map((c, i) => {
            const name = [c.first_name, c.last_initial ? `${c.last_initial}.` : null].filter(Boolean).join(" ");
            const meta = [c.stars != null ? formatStars(c.stars) : null, c.position, c.town].filter(Boolean).join(" · ");
            const disabled = c.invited || limitReached || !data.invites_available || busyToken != null;
            return (
              <View key={c.invite_token} style={[styles.row, i > 0 && styles.rowDivider]}>
                <PlayerAvatar person={{ first_name: c.first_name, last_name: c.last_initial, avatar_url: null }} size={36} />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                  {meta ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                {c.invited ? (
                  <Text style={styles.sent}>Invited</Text>
                ) : (
                  <Pressable
                    onPress={() => void invite(c.invite_token)}
                    disabled={disabled}
                    style={({ pressed }) => [styles.inviteBtn, disabled && styles.disabled, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${name}`}
                    accessibilityState={{ disabled }}
                  >
                    {busyToken === c.invite_token ? (
                      <ActivityIndicator color={themeColor().onAccent} size="small" />
                    ) : (
                      <Text style={styles.inviteText}>Invite</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
          {inviteError ? <Text style={styles.error}>{inviteError}</Text> : null}
          {!data.invites_available ? (
            <Text style={styles.note}>Invites are not available yet.</Text>
          ) : limitReached ? (
            <Text style={styles.note}>You have used all {data.invite_limit} invites for this game.</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
    card: {
      marginTop: 24,
      backgroundColor: themeColor().card,
      borderWidth: 1,
      borderColor: themeColor().line,
      borderRadius: radius.card,
      padding: 16,
    },
    title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    sub: { marginTop: 4, marginBottom: 8, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
    loading: { marginTop: 12 },
    errorBlock: { marginTop: 8, gap: 8 },
    note: { marginTop: 8, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
    error: { marginTop: 8, fontSize: 13, fontFamily: "Inter_500Medium", color: themeColor().coralText },
    link: { fontSize: 14, fontFamily: "Inter_500Medium", color: themeColor().pitchText },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    rowDivider: { borderTopWidth: 1, borderTopColor: themeColor().line },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    name: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().text },
    meta: { fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
    inviteBtn: {
      minWidth: 72,
      alignItems: "center",
      backgroundColor: themeColor().accent,
      borderRadius: radius.button,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    inviteText: { color: themeColor().onAccent, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    sent: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: themeColor().pitchText },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.88 },
  });
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}
