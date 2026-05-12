import { CaptainClaimModal } from "@/components/CaptainClaimModal";
import { FieldTournamentCard } from "@/components/FieldTournamentCard";
import { useAuth } from "@/context/AuthContext";
import { useSelectedRegion } from "@/context/SelectedRegionContext";
import { useFieldTournament } from "@/hooks/useFieldTournament";
import { siteOrigin } from "@/lib/env";
import { serviceRegionName } from "@/lib/serviceRegions";
import {
  fetchPickupFindPlayers,
  fetchTournamentRosterCaptain,
  postTournamentRoster,
  type PickupFindPlayerResult,
} from "@/lib/siteApi";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "@react-navigation/native";
import { useNavigation, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";

const PROCESSING_STATUSES = new Set([
  "payment_received",
  "roster_pending",
  "verification_in_progress",
  "flagged_for_review",
]);

type CaptainClaimSnapshot = {
  id: string | null;
  status: string;
  payment_due_at: string | null;
};

type RosterRow = {
  id: string;
  user_id: string;
  status: string;
  display_name?: string;
  username?: string | null;
  playing_position?: string | null;
};

type JoinRequestRow = {
  id: string;
  requester_user_id: string;
  message: string | null;
  display_name?: string;
  username?: string | null;
  playing_position?: string | null;
};

function formatPaymentDueAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function alertCaptainPayError(errMsg: string) {
  const lower = errMsg.toLowerCase();
  if (lower.includes("no_captain_claim")) {
    Alert.alert("", "You need to submit a captain claim first");
  } else if (lower.includes("already_confirmed")) {
    Alert.alert("", "Your payment is already confirmed");
  } else if (lower.includes("waiver_required")) {
    Alert.alert("", "Accept the waiver before paying");
  } else if (lower.includes("claim_expired")) {
    Alert.alert("", "Your claim expired submit a new one");
  } else {
    Alert.alert("", errMsg);
  }
}

export default function FieldTournamentDetailScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { region } = useSelectedRegion();
  const { session, supabase } = useAuth();
  const { loading, error, payload, reload } = useFieldTournament();
  const [payBusy, setPayBusy] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [captainClaim, setCaptainClaim] = useState<CaptainClaimSnapshot | null>(null);
  const [captainClaimLoading, setCaptainClaimLoading] = useState(false);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [joinRequestRows, setJoinRequestRows] = useState<JoinRequestRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteFound, setInviteFound] = useState<PickupFindPlayerResult | null>(null);
  const [inviteSearchBusy, setInviteSearchBusy] = useState(false);
  const [inviteSendBusy, setInviteSendBusy] = useState(false);
  const [rosterBusyId, setRosterBusyId] = useState<string | null>(null);

  async function handleCaptainPay() {
    const token = session?.access_token;
    if (!token) return;
    const base = siteOrigin();
    if (!base) {
      Alert.alert("", "Set EXPO_PUBLIC_SITE_URL in mobile/.env");
      return;
    }

    setPayBusy(true);
    try {
      const res = await fetch(`${base}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!res.ok) {
        Alert.alert("Payment error", `Status ${res.status}: ${JSON.stringify(data)}`);
        return;
      }

      if (res.ok && typeof data.url === "string" && data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        return;
      }

      const errMsg =
        typeof data.error === "string" && data.error.trim()
          ? data.error.trim()
          : `Could not start checkout (${res.status}).`;
      alertCaptainPayError(errMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error.";
      Alert.alert("", msg);
    } finally {
      setPayBusy(false);
    }
  }

  useEffect(() => {
    navigation.setOptions?.({
      title: "In-person tournament",
      headerTitleAlign: "center",
      headerStyle: {
        backgroundColor: "#0a0a0a",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
      },
      headerTintColor: "#fff",
      headerShadowVisible: false,
    });
  }, [navigation]);

  const t = payload?.tournament;

  useEffect(() => {
    if (t?.title) {
      navigation.setOptions?.({ title: String(t.title).slice(0, 42) });
    }
  }, [navigation, t?.title]);

  const tournamentId = t?.id ?? null;
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!supabase || !tournamentId || !userId) {
      setCaptainClaim(null);
      setCaptainClaimLoading(false);
      return;
    }
    let cancelled = false;
    setCaptainClaimLoading(true);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("tournament_captains")
        .select("id, status, payment_due_at")
        .eq("tournament_id", tournamentId)
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      setCaptainClaimLoading(false);
      if (qErr) {
        setCaptainClaim(null);
        return;
      }
      if (!data) {
        setCaptainClaim(null);
        return;
      }
      const due =
        typeof data.payment_due_at === "string"
          ? data.payment_due_at
          : data.payment_due_at != null
            ? String(data.payment_due_at)
            : null;
      setCaptainClaim({
        id: typeof data.id === "string" ? data.id : data.id != null ? String(data.id) : null,
        status: String(data.status ?? ""),
        payment_due_at: due,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, tournamentId, userId, payload]);

  const claimedTeams = payload?.claimedTeams ?? 0;
  const maxTeams = t?.maxTeams ?? 0;
  const spotsRemaining = Math.max(0, maxTeams - claimedTeams);
  const slotsFull = !!t && (spotsRemaining <= 0 || !!payload?.full);
  const claimDisabled = !t || slotsFull;

  const claimsClosed = (() => {
    const startAt = (t as any)?.start_at;
    if (typeof startAt !== "string" || !startAt) return false;
    const startMs = new Date(startAt).getTime();
    if (!Number.isFinite(startMs)) return false;
    return startMs - 24 * 60 * 60 * 1000 < Date.now();
  })();

  const paymentDueMs =
    captainClaim?.payment_due_at != null ? new Date(captainClaim.payment_due_at).getTime() : NaN;
  const paymentWindowOpen =
    captainClaim?.status === "payment_pending" &&
    Number.isFinite(paymentDueMs) &&
    paymentDueMs > Date.now();

  const awaitingStaff =
    !!captainClaim &&
    (captainClaim.status === "claim_submitted" || captainClaim.status === "captain_not_verified");

  const showProcessing =
    !!captainClaim && PROCESSING_STATUSES.has(captainClaim.status);

  const showExpiredReclaimCard =
    !!session &&
    !!captainClaim &&
    (captainClaim.status === "released_expired" ||
      (captainClaim.status === "payment_pending" && !paymentWindowOpen));

  /** Avoid flashing "Claim" before the Supabase captain row loads for signed-in users. */
  const sessionClaimReady = !userId || !captainClaimLoading;

  const showClaimButton =
    !claimDisabled &&
    !claimsClosed &&
    sessionClaimReady &&
    (!session ||
      !captainClaim ||
      captainClaim.status === "released_expired" ||
      (captainClaim.status === "payment_pending" && !paymentWindowOpen));

  function openClaimModal() {
    if (!session) {
      Alert.alert("", "Sign in to claim a captain spot.");
      return;
    }
    if (claimDisabled) return;
    setClaimModalOpen(true);
  }

  const captainRecordId =
    captainClaim?.status === "confirmed" && captainClaim.id ? captainClaim.id : null;

  const loadRoster = useCallback(async () => {
    const tok = session?.access_token;
    if (!tok || !captainRecordId) {
      setRosterRows([]);
      setJoinRequestRows([]);
      return;
    }
    setRosterLoading(true);
    try {
      const r = await fetchTournamentRosterCaptain(tok, captainRecordId);
      if (!r.ok || !r.json || typeof r.json !== "object") {
        setRosterRows([]);
        setJoinRequestRows([]);
        return;
      }
      const j = r.json as { roster?: RosterRow[]; join_requests?: JoinRequestRow[] };
      setRosterRows(Array.isArray(j.roster) ? j.roster : []);
      setJoinRequestRows(Array.isArray(j.join_requests) ? j.join_requests : []);
    } finally {
      setRosterLoading(false);
    }
  }, [session?.access_token, captainRecordId]);

  useEffect(() => {
    if (captainRecordId) void loadRoster();
    else {
      setRosterRows([]);
      setJoinRequestRows([]);
    }
  }, [captainRecordId, loadRoster]);

  useFocusEffect(
    useCallback(() => {
      if (captainRecordId) void loadRoster();
    }, [captainRecordId, loadRoster]),
  );

  function rosterStatusLabel(s: string) {
    if (s === "invited") return "Invited";
    if (s === "accepted") return "Accepted";
    if (s === "declined") return "Declined";
    return s;
  }

  async function onInviteSearch() {
    const tok = session?.access_token;
    if (!tok) return;
    setInviteSearchBusy(true);
    setInviteFound(null);
    try {
      const r = await fetchPickupFindPlayers(tok, inviteQuery, { limit: 5 });
      if (!r.ok) {
        Alert.alert("", r.error ?? "Search failed. Try again.");
        return;
      }
      if (r.players.length === 0) {
        Alert.alert("", "No player matched that handle or name. Try their exact username, or enter their email and send (email lookup is server-side).");
        return;
      }
      if (r.players.length > 1) {
        Alert.alert("", "Several players matched. Use a more specific username.");
        return;
      }
      setInviteFound(r.players[0]!);
    } finally {
      setInviteSearchBusy(false);
    }
  }

  async function onInviteSend() {
    const tok = session?.access_token;
    if (!tok || !captainRecordId || !tournamentId) return;
    const idRaw = inviteQuery.trim();
    if (!idRaw) return;
    const emailish = /@/.test(idRaw);
    if (!inviteFound && !emailish) {
      Alert.alert("", "Search to confirm the player, or enter the email on their CT Pickup account.");
      return;
    }
    setInviteSendBusy(true);
    try {
      const r = await postTournamentRoster(tok, {
        action: "invite_player",
        captain_id: captainRecordId,
        tournament_id: tournamentId,
        identifier: idRaw,
      });
      const err = (r.json as { error?: string })?.error;
      if (!r.ok) {
        Alert.alert("", err || `Invite failed (${r.status})`);
        return;
      }
      setInviteOpen(false);
      setInviteQuery("");
      setInviteFound(null);
      await loadRoster();
    } finally {
      setInviteSendBusy(false);
    }
  }

  function onRemoveRoster(row: RosterRow) {
    const tok = session?.access_token;
    if (!tok) return;
    Alert.alert("Remove player", `Remove ${row.display_name || row.username || "this player"} from your roster?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRosterBusyId(row.id);
          try {
            const r = await postTournamentRoster(tok, { action: "remove", roster_id: row.id });
            const err = (r.json as { error?: string })?.error;
            if (!r.ok) {
              Alert.alert("", err || "Could not remove");
              return;
            }
            await loadRoster();
          } finally {
            setRosterBusyId(null);
          }
        },
      },
    ]);
  }

  function onRespondJoinRequest(req: JoinRequestRow, approve: boolean) {
    const tok = session?.access_token;
    if (!tok) return;
    const title = approve ? "Approve join request?" : "Decline join request?";
    Alert.alert(title, `${req.display_name || req.username || "This player"} — ${req.message || "No message"}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: approve ? "Approve" : "Decline",
        style: approve ? "default" : "destructive",
        onPress: async () => {
          setRosterBusyId(req.id);
          try {
            const r = await postTournamentRoster(tok, {
              action: "respond_request",
              request_id: req.id,
              approve,
            });
            const err = (r.json as { error?: string })?.error;
            if (!r.ok) {
              Alert.alert("", err || "Could not update request");
              return;
            }
            await loadRoster();
          } finally {
            setRosterBusyId(null);
          }
        },
      },
    ]);
  }

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>HUB · {serviceRegionName(region)}</Text>
      <Text style={styles.lead}>
        Outdoor bracket hub for this state team counts and announcements match what staff publish online. Captain claims
        and roster slots follow tournament rules on the server.
      </Text>

      <FieldTournamentCard loading={loading} error={error} payload={payload} style={{ marginTop: 8 }} />

      <Pressable
        style={({ pressed }) => [styles.statusLinkRow, pressed && { opacity: 0.9 }]}
        onPress={() => (router.push as (href: string) => void)("/tournament-status")}
        accessibilityRole="button"
        accessibilityLabel="Tournament status"
      >
        <View style={styles.statusLinkLeft}>
          <View style={styles.statusLinkIconWrap}>
            <FontAwesome name="trophy" size={16} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.statusLinkText}>Tournament status</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
      </Pressable>

      {t ? (
        <View style={styles.statsRow}>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>Minimum to confirm</Text>
            <Text style={styles.chipValue}>{t.officialThreshold || "—"}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>Teams claimed</Text>
            <Text style={styles.chipValue}>
              {claimedTeams} / {maxTeams || "—"}
            </Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>Spots remaining</Text>
            <Text style={styles.chipValue}>{spotsRemaining}</Text>
          </View>
        </View>
      ) : null}

      {t ? (
        <>
          {session && captainClaimLoading ? (
            <ActivityIndicator style={{ marginTop: 14 }} color={LIME} />
          ) : null}

          {session && sessionClaimReady && captainClaim?.status !== "confirmed" && tournamentId ? (
            <Pressable
              style={({ pressed }) => [styles.findTeamBtn, pressed && { opacity: 0.9 }]}
              onPress={() => (router.push as (href: string) => void)("/tournament-join")}
              accessibilityRole="button"
              accessibilityLabel="Find a team"
            >
              <FontAwesome name="users" size={16} color="#111" style={{ marginRight: 8 }} />
              <Text style={styles.findTeamBtnText}>Find a team</Text>
            </Pressable>
          ) : null}

          {session && captainClaim?.status === "confirmed" ? (
            <View style={styles.confirmedBanner}>
              <Text style={styles.confirmedBannerText}>Your team is confirmed</Text>
            </View>
          ) : null}

          {session && captainClaim?.status === "confirmed" && captainRecordId ? (
            <View style={styles.myTeamSection}>
              <Text style={styles.sectionTitle}>My Team</Text>
              <Text style={styles.sectionSub}>Roster invites and join requests for your confirmed squad.</Text>

              <Pressable
                style={({ pressed }) => [styles.inviteOpenBtn, pressed && { opacity: 0.9 }]}
                onPress={() => {
                  setInviteOpen(true);
                  setInviteQuery("");
                  setInviteFound(null);
                }}
              >
                <FontAwesome name="user-plus" size={15} color="#111" style={{ marginRight: 8 }} />
                <Text style={styles.inviteOpenBtnText}>Invite player</Text>
              </Pressable>

              {rosterLoading ? <ActivityIndicator style={{ marginTop: 12 }} color={LIME} /> : null}

              {rosterRows.length ? (
                <View style={{ marginTop: 14 }}>
                  {rosterRows.map((row) => (
                    <View key={row.id} style={styles.rosterRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rosterName} numberOfLines={1}>
                          {row.display_name || row.username || "Player"}
                        </Text>
                        <Text style={styles.rosterMeta} numberOfLines={1}>
                          @{row.username || "—"} · {row.playing_position || "Position —"} ·{" "}
                          {rosterStatusLabel(row.status)}
                        </Text>
                      </View>
                      <Pressable
                        style={[styles.removeBtn, rosterBusyId === row.id && { opacity: 0.5 }]}
                        disabled={rosterBusyId === row.id}
                        onPress={() => onRemoveRoster(row)}
                      >
                        <Text style={styles.removeBtnText}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : !rosterLoading ? (
                <Text style={styles.emptyRoster}>No invited players yet.</Text>
              ) : null}

              {joinRequestRows.length ? (
                <View style={{ marginTop: 22 }}>
                  <Text style={styles.joinReqTitle}>Join requests</Text>
                  {joinRequestRows.map((req) => (
                    <View key={req.id} style={styles.joinReqCard}>
                      <Text style={styles.rosterName} numberOfLines={1}>
                        {req.display_name || req.username || "Player"}
                      </Text>
                      <Text style={styles.rosterMeta} numberOfLines={2}>
                        @{req.username || "—"} · {req.playing_position || "—"}
                        {req.message ? ` · “${req.message}”` : ""}
                      </Text>
                      <View style={styles.joinReqActions}>
                        <Pressable
                          style={[styles.approveBtn, rosterBusyId === req.id && { opacity: 0.5 }]}
                          disabled={rosterBusyId === req.id}
                          onPress={() => onRespondJoinRequest(req, true)}
                        >
                          <Text style={styles.approveBtnText}>Approve</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.declineBtn, rosterBusyId === req.id && { opacity: 0.5 }]}
                          disabled={rosterBusyId === req.id}
                          onPress={() => onRespondJoinRequest(req, false)}
                        >
                          <Text style={styles.declineBtnText}>Decline</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {session && awaitingStaff ? (
            <View style={styles.claimStatusCard}>
              <Text style={styles.claimStatusCardText}>
                Your captain claim has been submitted. Staff will verify and contact you.
              </Text>
            </View>
          ) : null}

          {session && showProcessing ? (
            <View style={styles.claimStatusCard}>
              <Text style={styles.claimStatusCardText}>Your captain registration is in progress.</Text>
            </View>
          ) : null}

          {session && paymentWindowOpen && captainClaim?.payment_due_at ? (
            <View style={styles.claimStatusCard}>
              <Text style={styles.claimStatusCardText}>
                You have an active captain claim. Complete your payment before the deadline.
              </Text>
              <Text style={styles.paymentDueLine}>
                Payment due by {formatPaymentDueAt(captainClaim.payment_due_at)}
              </Text>
              <Pressable
                style={[styles.captainPayBtnInCard, payBusy && styles.captainPayBtnDisabled]}
                disabled={payBusy}
                onPress={() => void handleCaptainPay()}
                accessibilityRole="button"
                accessibilityLabel="Pay captain fee"
              >
                {payBusy ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={styles.captainPayBtnTextDark}>Pay captain fee $250</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {session && showExpiredReclaimCard ? (
            <View style={styles.claimStatusCard}>
              <Text style={styles.claimStatusCardText}>
                Your claim expired. You can submit a new one.
              </Text>
            </View>
          ) : null}

          {showClaimButton ? (
            <Pressable
              style={[styles.claimBtn, claimDisabled && styles.claimBtnDisabled]}
              disabled={claimDisabled}
              onPress={openClaimModal}
              accessibilityRole="button"
              accessibilityLabel="Claim a team"
            >
              <Text style={styles.claimBtnText}>Claim a team</Text>
            </Pressable>
          ) : null}
          {slotsFull ? (
            <Text style={styles.claimSubText}>Captain slots are full.</Text>
          ) : claimsClosed ? (
            <Text style={styles.claimSubText}>Claims closed — free-for-all roster</Text>
          ) : !session ? (
            <Text style={styles.claimSubText}>Sign in to submit a captain claim.</Text>
          ) : null}
        </>
      ) : null}

      {payload?.tournament && payload.tournament.announcement ? (
        <View style={styles.note}>
          <FontAwesome name="bullhorn" size={16} color="rgba(163,230,53,0.85)" />
          <Text style={styles.noteText}>{payload.tournament.announcement}</Text>
        </View>
      ) : null}

      <CaptainClaimModal
        visible={claimModalOpen}
        accessToken={session?.access_token ?? null}
        tournamentStartAt={typeof (t as any)?.start_at === "string" ? (t as any).start_at : null}
        payBusy={payBusy}
        onClose={() => setClaimModalOpen(false)}
        onClaimRecorded={() => void reload()}
        onProceedToPay={handleCaptainPay}
      />
    </ScrollView>

      <Modal
        visible={inviteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteOpen(false)}
      >
        <View style={styles.inviteModalRoot}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setInviteOpen(false)} />
          <View style={styles.inviteModalSheet}>
          <Text style={styles.inviteModalTitle}>Invite player</Text>
          <Text style={styles.inviteModalHint}>Username or email (must match their CT Pickup account).</Text>
          <TextInput
            value={inviteQuery}
            onChangeText={(v) => {
              setInviteQuery(v);
              setInviteFound(null);
            }}
            placeholder="username or email"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.inviteInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.inviteSearchBtn, inviteSearchBusy && { opacity: 0.6 }]}
            disabled={inviteSearchBusy}
            onPress={() => void onInviteSearch()}
          >
            {inviteSearchBusy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text style={styles.inviteSearchBtnText}>Search</Text>
            )}
          </Pressable>
          {inviteFound ? (
            <View style={styles.inviteFoundBox}>
              <Text style={styles.inviteFoundLabel}>Found</Text>
              <Text style={styles.inviteFoundName}>{inviteFound.full_name}</Text>
              {inviteFound.username ? (
                <Text style={styles.inviteFoundUser}>@{inviteFound.username}</Text>
              ) : null}
            </View>
          ) : null}
          <Pressable
            style={[styles.inviteSendBtn, ((!inviteFound && !/@/.test(inviteQuery.trim())) || inviteSendBusy) && { opacity: 0.45 }]}
            disabled={(!inviteFound && !/@/.test(inviteQuery.trim())) || inviteSendBusy}
            onPress={() => void onInviteSend()}
          >
            {inviteSendBusy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text style={styles.inviteSendBtnText}>Send invite</Text>
            )}
          </Pressable>
          <Pressable style={styles.inviteCancelBtn} onPress={() => setInviteOpen(false)}>
            <Text style={styles.inviteCancelBtnText}>Cancel</Text>
          </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.65)",
  },
  lead: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.58)",
  },
  statusLinkRow: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLinkLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusLinkIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(163,230,53,0.08)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.35)",
  },
  statusLinkText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.9)" },
  statsRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.55)",
    textTransform: "uppercase",
  },
  chipValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
  },
  claimBtn: {
    marginTop: 14,
    width: "100%",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  claimBtnDisabled: { opacity: 0.45 },
  claimBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  claimSubText: {
    marginTop: 8,
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
  },
  note: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.22)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21, color: "rgba(255,255,255,0.78)" },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#fff" },
  body: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.62)",
  },
  captainPayBtnInCard: {
    marginTop: 14,
    width: "100%",
    alignSelf: "stretch",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  captainPayBtnDisabled: { opacity: 0.45 },
  captainPayBtnTextDark: { color: "#111", fontWeight: "800", fontSize: 15 },
  confirmedBanner: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  confirmedBannerText: {
    fontSize: 15,
    fontWeight: "800",
    color: LIME,
    textAlign: "center",
  },
  claimStatusCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  claimStatusCardText: {
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.82)",
  },
  paymentDueLine: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
  },
  findTeamBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  findTeamBtnText: { color: LIME, fontWeight: "800", fontSize: 15 },
  myTeamSection: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  sectionSub: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(255,255,255,0.52)",
  },
  inviteOpenBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: LIME,
  },
  inviteOpenBtnText: { color: "#111", fontWeight: "800", fontSize: 14 },
  rosterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  rosterName: { fontSize: 15, fontWeight: "700", color: "#fff" },
  rosterMeta: { marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.5)" },
  removeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.5)",
  },
  removeBtnText: { color: "rgba(248,113,113,0.95)", fontWeight: "700", fontSize: 12 },
  emptyRoster: { marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.45)" },
  joinReqTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: LIME,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  joinReqCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  joinReqActions: { marginTop: 12, flexDirection: "row", gap: 10 },
  approveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: LIME,
    alignItems: "center",
  },
  approveBtnText: { color: "#111", fontWeight: "800", fontSize: 13 },
  declineBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
  },
  declineBtnText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 13 },
  inviteModalRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  inviteModalSheet: {
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "#121212",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  inviteModalTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  inviteModalHint: { marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  inviteInput: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 15,
  },
  inviteSearchBtn: {
    marginTop: 12,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  inviteSearchBtnText: { color: "#111", fontWeight: "800", fontSize: 14 },
  inviteFoundBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(163,230,53,0.08)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.3)",
  },
  inviteFoundLabel: { fontSize: 11, fontWeight: "800", color: LIME, textTransform: "uppercase" },
  inviteFoundName: { marginTop: 6, fontSize: 16, fontWeight: "800", color: "#fff" },
  inviteFoundUser: { marginTop: 4, fontSize: 14, color: "rgba(255,255,255,0.55)" },
  inviteSendBtn: {
    marginTop: 16,
    backgroundColor: LIME,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  inviteSendBtnText: { color: "#111", fontWeight: "800", fontSize: 15 },
  inviteCancelBtn: { marginTop: 12, paddingVertical: 12, alignItems: "center" },
  inviteCancelBtnText: { color: "rgba(255,255,255,0.45)", fontWeight: "600", fontSize: 14 },
});
