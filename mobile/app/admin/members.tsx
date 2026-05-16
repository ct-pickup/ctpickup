import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { PlayerLocationBreakdown } from "@/components/admin/PlayerLocationBreakdown";
import { useAuth } from "@/context/AuthContext";
import { fetchAdminAnalyticsDashboard } from "@/lib/adminApi";
import { hapticError, hapticGoal, hapticTap } from "@/lib/haptics";
import { siteOrigin } from "@/lib/env";

const LIME = "#a3e635";

const PENDING_BADGE_BG = "rgba(245, 158, 11, 0.22)";
const PENDING_BADGE_BORDER = "rgba(245, 158, 11, 0.55)";
const PENDING_BADGE_TEXT = "#fbbf24";

function utcMonthKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

const TIERS = [
  { rank: 1, label: "1a" },
  { rank: 2, label: "1b" },
  { rank: 3, label: "2" },
  { rank: 4, label: "3" },
  { rank: 5, label: "4" },
  { rank: 6, label: "5" },
];

type AdminTab = "members" | "reports";

type PlayerReport = {
  id: string;
  reason: string;
  created_at: string;
  reporter_name: string;
  reported_name: string;
  reported_user_id: string;
  message_id: string | null;
  room_id: string | null;
  type: "profile" | "message";
};

type Member = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  instagram: string | null;
  tier: string | null;
  tier_rank: number | null;
  approved: boolean;
  created_at: string;
  playing_position: string | null;
  zip_code: string | null;
  is_banned: boolean;
  ban_reason: string | null;
  wins_override: number | null;
  losses_override: number | null;
  player_of_day_override: number | null;
  defender_of_day_override: number | null;
  midfielder_of_day_override: number | null;
  attacker_of_day_override: number | null;
};

export default function AdminMembersScreen() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editStats, setEditStats] = useState<Record<string, Record<string, number | null>>>({});
  const [banReason, setBanReason] = useState<Record<string, string>>({});
  const [dmTarget, setDmTarget] = useState<Member | null>(null);
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [playersByVenue, setPlayersByVenue] = useState<{ venue: string; count: number }[]>([]);
  const [playersByZip, setPlayersByZip] = useState<{ zip_code: string; count: number }[]>([]);
  const [adminTab, setAdminTab] = useState<AdminTab>("members");
  const [reports, setReports] = useState<PlayerReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    setReportsLoading(true);
    setReportsError(null);
    try {
      const origin = siteOrigin();
      if (!origin) {
        setReportsError("Missing site URL.");
        setReports([]);
        return;
      }
      const res = await fetch(`${origin}/api/admin/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json()) as { error?: string; reports?: PlayerReport[] };
      if (!res.ok) {
        setReportsError(j.error || "Failed to load reports");
        setReports([]);
        return;
      }
      setReports(j.reports || []);
    } catch (e) {
      setReportsError(e instanceof Error ? e.message : "Request failed");
      setReports([]);
    } finally {
      setReportsLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (adminTab !== "reports") return;
    void loadReports();
  }, [adminTab, loadReports]);

  const load = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const origin = siteOrigin();
      if (!origin) {
        setError("Missing site URL.");
        setMembers([]);
        setPlayersByVenue([]);
        setPlayersByZip([]);
        return;
      }
      const [res, analyticsRes] = await Promise.all([
        fetch(`${origin}/api/admin/members`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetchAdminAnalyticsDashboard(token, { month: utcMonthKey() }),
      ]);
      const j = await res.json();
      if (analyticsRes.ok && analyticsRes.data.ok) {
        setPlayersByVenue(analyticsRes.data.players_by_venue ?? []);
        setPlayersByZip(analyticsRes.data.players_by_zip ?? []);
      } else {
        setPlayersByVenue([]);
        setPlayersByZip([]);
      }
      if (!res.ok) {
        setError((j as { error?: string }).error || "Failed to load");
        return;
      }
      setMembers((j as { members?: Member[] }).members || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  async function patchMember(userId: string, update: Record<string, unknown>) {
    const token = session?.access_token;
    if (!token) return false;
    const res = await fetch(`${siteOrigin()}/api/admin/members`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, ...update }),
    });
      const j = await res.json();
      if (!res.ok) {
        void hapticError();
        Alert.alert("Error", j.error || "Failed");
        return false;
      }
      return true;
  }

  async function setTier(userId: string, tier_rank: number, tierLabel: string) {
    void hapticTap();
    setBusy("tier:" + userId);
    const ok = await patchMember(userId, { tier_rank, tier: tierLabel });
    if (ok) setMembers((p) => p.map((m) => m.id === userId ? { ...m, tier_rank, tier: tierLabel } : m));
    setBusy(null);
  }

  async function approvePlayer(userId: string) {
    void hapticGoal();
    setBusy("approve:" + userId);
    const ok = await patchMember(userId, { approved: true });
    if (ok) setMembers((p) => p.map((m) => (m.id === userId ? { ...m, approved: true } : m)));
    setBusy(null);
  }

  async function rejectApproval(userId: string) {
    void hapticTap();
    setBusy("reject:" + userId);
    const ok = await patchMember(userId, { approved: false });
    if (ok) setMembers((p) => p.map((m) => (m.id === userId ? { ...m, approved: false } : m)));
    setBusy(null);
  }

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (!a.approved && b.approved) return -1;
      if (a.approved && !b.approved) return 1;
      const ta = Date.parse(a.created_at) || 0;
      const tb = Date.parse(b.created_at) || 0;
      return tb - ta;
    });
  }, [members]);

  async function saveStats(userId: string) {
    void hapticGoal();
    setBusy("stats:" + userId);
    const s = editStats[userId] || {};
    const ok = await patchMember(userId, s);
    if (ok) {
      setMembers((p) => p.map((m) => m.id === userId ? { ...m, ...s } : m));
      Alert.alert("Saved", "Stats updated.");
    }
    setBusy(null);
  }

  async function banPlayer(userId: string, currentlyBanned: boolean) {
    if (!currentlyBanned) {
      const reason = banReason[userId] || "";
      if (!reason.trim()) {
        void hapticError();
        Alert.alert("Required", "Enter a ban reason first.");
        return;
      }
      Alert.alert("Ban player?", "They will receive a push notification.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Ban", style: "destructive", onPress: async () => {
            setBusy("ban:" + userId);
            const ok = await patchMember(userId, { is_banned: true, ban_reason: reason, approved: false });
            if (ok) setMembers((p) => p.map((m) => m.id === userId ? { ...m, is_banned: true, ban_reason: reason, approved: false } : m));
            setBusy(null);
          }
        }
      ]);
    } else {
      setBusy("ban:" + userId);
      const ok = await patchMember(userId, { is_banned: false, ban_reason: null, approved: true });
      if (ok) setMembers((p) => p.map((m) => m.id === userId ? { ...m, is_banned: false, ban_reason: null, approved: true } : m));
      setBusy(null);
    }
  }

  async function sendAdminDm() {
    const token = session?.access_token;
    if (!token || !dmTarget) return;
    const message = dmText.trim();
    if (!message) {
      void hapticError();
      Alert.alert("Required", "Enter a message.");
      return;
    }
    setDmSending(true);
    try {
      const res = await fetch(`${siteOrigin()}/api/admin/dm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: dmTarget.id, message }),
      });
      const j = (await res.json()) as { error?: string; room_id?: string };
      if (!res.ok) {
        void hapticError();
        Alert.alert("Error", j.error || "Failed to send");
        return;
      }
      void hapticGoal();
      const roomId = j.room_id;
      setDmTarget(null);
      setDmText("");
      if (roomId) {
        router.push({ pathname: "/(tabs)/messages/thread", params: { id: roomId } });
      }
    } catch (e) {
      void hapticError();
      Alert.alert("Error", e instanceof Error ? e.message : "Request failed");
    } finally {
      setDmSending(false);
    }
  }

  async function deleteProfile(userId: string, name: string) {
    Alert.alert("Delete " + name + "?", "This permanently deletes their account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          setBusy("delete:" + userId);
          const token = session?.access_token;
          if (!token) return;
          const res = await fetch(`${siteOrigin()}/api/admin/members`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId }),
          });
          const j = await res.json();
          if (!res.ok) {
            void hapticError();
            Alert.alert("Error", j.error || "Failed");
          } else {
            setMembers((p) => p.filter((m) => m.id !== userId));
          }
          setBusy(null);
        }
      }
    ]);
  }

  function formatReportReason(reason: string): string {
    const r = reason.trim();
    if (!r) return reason;
    return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
  }

  async function dismissReport(reportId: string) {
    void hapticTap();
    Alert.alert("Dismiss report?", "This removes the report from the queue.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Dismiss",
        onPress: async () => {
          const token = session?.access_token;
          if (!token) return;
          setReportBusy("dismiss:" + reportId);
          try {
            const res = await fetch(`${siteOrigin()}/api/admin/reports`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ id: reportId }),
            });
            const j = (await res.json()) as { error?: string };
            if (!res.ok) {
              void hapticError();
              Alert.alert("Error", j.error || "Failed");
            } else {
              void hapticGoal();
              setReports((p) => p.filter((r) => r.id !== reportId));
            }
          } catch (e) {
            void hapticError();
            Alert.alert("Error", e instanceof Error ? e.message : "Request failed");
          } finally {
            setReportBusy(null);
          }
        },
      },
    ]);
  }

  function banFromReport(reportedUserId: string, reportReason: string, reportType: "profile" | "message") {
    void hapticTap();
    Alert.alert("Ban player?", "They will receive a push notification.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Ban",
        style: "destructive",
        onPress: async () => {
          const banReasonText = `${reportType === "message" ? "Message" : "Profile"} report: ${reportReason}`;
          setReportBusy("ban:" + reportedUserId);
          const ok = await patchMember(reportedUserId, {
            is_banned: true,
            ban_reason: banReasonText,
            approved: false,
          });
          if (ok) {
            void hapticGoal();
            setMembers((p) =>
              p.map((m) =>
                m.id === reportedUserId
                  ? { ...m, is_banned: true, ban_reason: banReasonText, approved: false }
                  : m,
              ),
            );
          }
          setReportBusy(null);
        },
      },
    ]);
  }

  const renderReport = ({ item }: { item: PlayerReport }) => {
    const busyDismiss = reportBusy === "dismiss:" + item.id;
    const busyBan = reportBusy === "ban:" + item.reported_user_id;
    const anyBusy = reportBusy !== null;
    const when = new Date(item.created_at).toLocaleString();
    const typeLabel = item.type === "message" ? "Message Report" : "Profile Report";
    return (
      <View style={styles.card}>
        <Text style={styles.reportNameLine}>
          <Text style={styles.reportNameStrong}>{item.reporter_name}</Text>
          <Text style={styles.reportArrow}> → Reported → </Text>
          <Text style={styles.reportNameStrong}>{item.reported_name}</Text>
        </Text>
        <View style={styles.reasonPill}>
          <Text style={styles.reasonPillText}>{formatReportReason(item.reason)}</Text>
        </View>
        <Text style={styles.reportTypeLine}>{typeLabel}</Text>
        <Text style={styles.reportDate}>{when}</Text>
        <View style={styles.reportActionsRow}>
          <Pressable
            onPress={() => {
              void hapticTap();
              router.push({ pathname: "/player/[id]", params: { id: item.reported_user_id } });
            }}
            disabled={anyBusy}
            style={[styles.reportActionBtn, styles.reportActionBtnLime]}
          >
            <Text style={styles.reportActionBtnLimeText}>View Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => banFromReport(item.reported_user_id, item.reason, item.type)}
            disabled={anyBusy}
            style={[styles.reportActionBtn, styles.reportActionBtnDanger]}
          >
            <Text style={styles.reportActionBtnDangerText}>{busyBan ? "…" : "Ban Player"}</Text>
          </Pressable>
          <Pressable
            onPress={() => void dismissReport(item.id)}
            disabled={anyBusy}
            style={styles.reportActionBtn}
          >
            <Text style={styles.reportActionBtnText}>{busyDismiss ? "…" : "Dismiss"}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderItem = ({ item }: { item: Member }) => {
    const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || item.id;
    const joined = new Date(item.created_at).toLocaleDateString();
    const isExpanded = expanded === item.id;
    const isBusy = busy !== null && busy.endsWith(item.id);
    const subLine1 = (item.username ? "@" + item.username : "") + (item.instagram ? (item.username ? " · ig " : "ig: ") + item.instagram : "");
    const subLine2 = (item.playing_position || "No position") + " · " + (item.zip_code || "No zip") + " · Joined " + joined;
    const statsFields: { key: keyof Member; label: string }[] = [
      { key: "wins_override", label: "Wins" },
      { key: "losses_override", label: "Losses" },
      { key: "player_of_day_override", label: "POD" },
      { key: "defender_of_day_override", label: "Def Day" },
      { key: "midfielder_of_day_override", label: "Mid Day" },
      { key: "attacker_of_day_override", label: "Att Day" },
    ];
    const pending = !item.approved && !item.is_banned;

    return (
      <View style={[styles.card, item.is_banned ? styles.cardBanned : null]}>
        <Pressable onPress={() => setExpanded(isExpanded ? null : item.id)}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={2}>
                  {name + (item.is_banned ? " X" : "")}
                </Text>
                {pending ? (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>Pending</Text>
                  </View>
                ) : null}
              </View>
              {subLine1.length > 0 ? <Text style={styles.sub}>{subLine1}</Text> : null}
              <Text style={styles.sub}>{subLine2}</Text>
            </View>
            <Text style={styles.chevron}>{isExpanded ? "^" : "v"}</Text>
          </View>
        </Pressable>
        {!item.is_banned ? (
          <View style={styles.membershipApprovalRow}>
            <Pressable
              onPress={() => void approvePlayer(item.id)}
              disabled={isBusy || item.approved}
              style={[
                styles.approveMembershipBtn,
                item.approved ? styles.approveMembershipBtnLocked : null,
                isBusy ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[styles.approveMembershipBtnText, item.approved ? styles.approveMembershipBtnTextMuted : null]}>
                {busy === "approve:" + item.id ? "…" : item.approved ? "Approved ✓" : "Approve"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void rejectApproval(item.id)}
              disabled={isBusy || !item.approved}
              style={[
                styles.rejectMembershipBtn,
                !item.approved ? styles.rejectMembershipBtnDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.rejectMembershipBtnText,
                  !item.approved ? styles.rejectMembershipBtnTextDisabled : null,
                ]}
              >
                {busy === "reject:" + item.id ? "…" : "Reject"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {isExpanded ? (
          <View style={{ marginTop: 12 }}>
            <View style={styles.tierRow}>
              <Text style={styles.label}>Tier:</Text>
              {TIERS.map((t) => (
                <Pressable key={t.rank} onPress={() => void setTier(item.id, t.rank, t.label)} disabled={isBusy}
                  style={[styles.tierChip, item.tier_rank === t.rank ? styles.tierChipActive : null]}>
                  <Text style={[styles.tierChipText, item.tier_rank === t.rank ? styles.tierChipTextActive : null]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                void hapticTap();
                setDmTarget(item);
                setDmText("");
              }}
              disabled={isBusy}
              style={[styles.actionBtn, styles.actionBtnLimeOutline, styles.messageOnlyBtn]}
            >
              <Text style={styles.actionBtnTextLime}>Message player</Text>
            </Pressable>
            <Text style={[styles.label, { marginTop: 14 }]}>Stats overrides</Text>
            <View style={styles.statsGrid}>
              {statsFields.map((f) => {
                const cur = editStats[item.id] || {};
                const rawVal = cur[f.key] !== undefined ? cur[f.key] : (item[f.key] as number | null);
                const val = rawVal !== null && rawVal !== undefined ? String(rawVal) : "";
                return (
                  <View key={f.key} style={styles.statField}>
                    <Text style={styles.statLabel}>{f.label}</Text>
                    <TextInput
                      style={styles.statInput}
                      value={val}
                      onChangeText={(v) => {
                        setEditStats((p) => ({
                          ...p,
                          [item.id]: { ...(p[item.id] || {}), [f.key]: v === "" ? null : Number(v) },
                        }));
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                    />
                  </View>
                );
              })}
            </View>
            <Pressable onPress={() => void saveStats(item.id)} disabled={isBusy}
              style={[styles.actionBtn, styles.actionBtnActive, { marginTop: 8 }]}>
              <Text style={styles.actionBtnTextActive}>{busy === "stats:" + item.id ? "Saving..." : "Save stats"}</Text>
            </Pressable>
            <Text style={[styles.label, { marginTop: 14 }]}>Ban reason</Text>
            <TextInput
              style={styles.banInput}
              value={banReason[item.id] !== undefined ? banReason[item.id] : (item.ban_reason || "")}
              onChangeText={(v) => setBanReason((p) => ({ ...p, [item.id]: v }))}
              placeholder="Reason for ban..."
              placeholderTextColor="rgba(255,255,255,0.3)"
            />
            <View style={styles.actionRow}>
              <Pressable onPress={() => void banPlayer(item.id, item.is_banned)} disabled={isBusy}
                style={[styles.actionBtn, item.is_banned ? styles.actionBtnActive : styles.actionBtnDanger]}>
                <Text style={[styles.actionBtnText, item.is_banned ? styles.actionBtnTextActive : styles.actionBtnTextDanger]}>
                  {busy === "ban:" + item.id ? "..." : item.is_banned ? "Unban" : "Ban player"}
                </Text>
              </Pressable>
              <Pressable onPress={() => void deleteProfile(item.id, name)} disabled={isBusy}
                style={[styles.actionBtn, styles.actionBtnDanger]}>
                <Text style={styles.actionBtnTextDanger}>{busy === "delete:" + item.id ? "Deleting..." : "Delete account"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const dmTargetName = dmTarget
    ? [dmTarget.first_name, dmTarget.last_name].filter(Boolean).join(" ") ||
      dmTarget.username ||
      dmTarget.id
    : "";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Modal
        visible={dmTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => !dmSending && setDmTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => !dmSending && setDmTarget(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Message {dmTargetName}</Text>
              <TextInput
                style={styles.modalInput}
                value={dmText}
                onChangeText={setDmText}
                placeholder="Type a direct message…"
                placeholderTextColor="rgba(255,255,255,0.35)"
                multiline
                editable={!dmSending}
              />
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => !dmSending && setDmTarget(null)}
                  style={[styles.modalBtn, styles.modalBtnGhost]}
                  disabled={dmSending}
                >
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void sendAdminDm()}
                  style={[styles.modalBtn, styles.modalBtnPrimary]}
                  disabled={dmSending || !dmText.trim()}
                >
                  {dmSending ? (
                    <ActivityIndicator color="#0a0a0a" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>Send</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
      <Text style={styles.title}>Members</Text>
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => {
            void hapticTap();
            setAdminTab("members");
          }}
          style={[styles.tabBtn, adminTab === "members" ? styles.tabBtnActive : null]}
        >
          <Text style={[styles.tabBtnText, adminTab === "members" ? styles.tabBtnTextActive : null]}>
            Members
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void hapticTap();
            setAdminTab("reports");
          }}
          style={[styles.tabBtn, adminTab === "reports" ? styles.tabBtnActive : null]}
        >
          <Text style={[styles.tabBtnText, adminTab === "reports" ? styles.tabBtnTextActive : null]}>
            Reports
          </Text>
        </Pressable>
      </View>
      {adminTab === "members" ? (
        <>
          {loading ? <ActivityIndicator color={LIME} style={{ marginTop: 32 }} /> : null}
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <FlatList
            data={sortedMembers}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            ListHeaderComponent={
              <PlayerLocationBreakdown playersByVenue={playersByVenue} playersByZip={playersByZip} />
            }
            ListEmptyComponent={!loading ? <Text style={styles.muted}>No members found.</Text> : null}
            onRefresh={load}
            refreshing={loading}
          />
        </>
      ) : (
        <>
          {reportsLoading && reports.length === 0 ? (
            <ActivityIndicator color={LIME} style={{ marginTop: 32 }} />
          ) : null}
          {reportsError ? <Text style={styles.err}>{reportsError}</Text> : null}
          <FlatList
            data={reports}
            keyExtractor={(r) => r.id}
            renderItem={renderReport}
            contentContainerStyle={{ padding: 16, paddingBottom: 60, flexGrow: 1 }}
            ListEmptyComponent={
              !reportsLoading ? <Text style={styles.muted}>No reports yet</Text> : null
            }
            onRefresh={loadReports}
            refreshing={reportsLoading}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", paddingHorizontal: 16, paddingVertical: 12 },
  card: { backgroundColor: "#111", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  cardBanned: { borderColor: "rgba(239,68,68,0.4)", backgroundColor: "#1a0a0a" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  name: { color: "#fff", fontSize: 15, fontWeight: "700", flexShrink: 1 },
  pendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: PENDING_BADGE_BG,
    borderWidth: 1,
    borderColor: PENDING_BADGE_BORDER,
  },
  pendingBadgeText: { color: PENDING_BADGE_TEXT, fontSize: 11, fontWeight: "800" },
  membershipApprovalRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  approveMembershipBtn: {
    flex: 2,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: LIME,
    borderWidth: 2,
    borderColor: "#bbf451",
    paddingHorizontal: 12,
  },
  approveMembershipBtnLocked: {
    backgroundColor: "rgba(163,230,53,0.18)",
    borderColor: "rgba(163,230,53,0.45)",
  },
  approveMembershipBtnText: { color: "#171717", fontSize: 14, fontWeight: "900" },
  approveMembershipBtnTextMuted: { color: LIME },
  rejectMembershipBtn: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(251,146,146,0.55)",
    backgroundColor: "rgba(239,68,68,0.12)",
    paddingHorizontal: 10,
  },
  rejectMembershipBtnDisabled: { opacity: 0.35 },
  rejectMembershipBtnText: { color: "#fca5a5", fontSize: 13, fontWeight: "800" },
  rejectMembershipBtnTextDisabled: { color: "rgba(255,255,255,0.25)" },
  messageOnlyBtn: { alignSelf: "stretch", marginTop: 8, flex: 0 },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 },
  chevron: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 6 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  tierChip: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  tierChipActive: { borderColor: "#a3e635", backgroundColor: "rgba(163,230,53,0.15)" },
  tierChipText: { color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: "700" },
  tierChipTextActive: { color: "#a3e635" },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtn: { borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", paddingHorizontal: 12, paddingVertical: 7, flex: 1, alignItems: "center" },
  actionBtnActive: { borderColor: "#a3e635", backgroundColor: "rgba(163,230,53,0.1)" },
  actionBtnDanger: { borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.1)" },
  actionBtnText: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },
  actionBtnTextActive: { color: "#a3e635", fontSize: 12, fontWeight: "700" },
  actionBtnTextDanger: { color: "#f87171", fontSize: 12, fontWeight: "700" },
  actionBtnLimeOutline: { borderColor: "rgba(163,230,53,0.45)" },
  actionBtnTextLime: { color: "#a3e635", fontSize: 12, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#141414",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 18,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginBottom: 12 },
  modalInput: {
    minHeight: 100,
    maxHeight: 180,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    color: "#fff",
    fontSize: 15,
    textAlignVertical: "top",
    marginBottom: 16,
    backgroundColor: "#0a0a0a",
  },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: { borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  modalBtnGhostText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 14 },
  modalBtnPrimary: { backgroundColor: LIME },
  modalBtnPrimaryText: { color: "#0a0a0a", fontWeight: "900", fontSize: 14 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statField: { width: "30%", minWidth: 90 },
  statLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, marginBottom: 3 },
  statInput: { backgroundColor: "#1a1a1a", borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", color: "#fff", padding: 6, fontSize: 13 },
  banInput: { backgroundColor: "#1a1a1a", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", color: "#fff", padding: 8, fontSize: 13, marginBottom: 8 },
  err: { color: "#f87171", padding: 16 },
  muted: { color: "rgba(255,255,255,0.35)", fontSize: 13 },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
  },
  tabBtnActive: { borderColor: LIME, backgroundColor: "rgba(163,230,53,0.12)" },
  tabBtnText: { color: "rgba(255,255,255,0.45)", fontSize: 14, fontWeight: "700" },
  tabBtnTextActive: { color: LIME },
  reportNameLine: { color: "#fff", fontSize: 14, lineHeight: 20 },
  reportNameStrong: { color: "#fff", fontWeight: "700" },
  reportArrow: { color: "rgba(255,255,255,0.4)", fontWeight: "600" },
  reasonPill: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(163, 230, 53, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(163, 230, 53, 0.45)",
  },
  reasonPillText: { color: LIME, fontSize: 12, fontWeight: "800" },
  reportTypeLine: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
  },
  reportDate: { color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 4 },
  reportActionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  reportActionBtn: {
    flexGrow: 1,
    minWidth: "30%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  reportActionBtnLime: { borderColor: "rgba(163,230,53,0.45)", backgroundColor: "rgba(163,230,53,0.08)" },
  reportActionBtnLimeText: { color: LIME, fontSize: 11, fontWeight: "800" },
  reportActionBtnDanger: { borderColor: "rgba(239,68,68,0.45)", backgroundColor: "rgba(239,68,68,0.1)" },
  reportActionBtnDangerText: { color: "#f87171", fontSize: 11, fontWeight: "800" },
  reportActionBtnText: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "700" },
});
