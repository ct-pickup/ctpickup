import { useAccountIntroReplay } from "@/context/AccountIntroReplayContext";
import { useReplayOpeningTheme } from "@/context/ReplayOpeningThemeContext";
import { useAdminMode } from "@/context/AdminModeContext";
import { useAuth } from "@/context/AuthContext";
import { useProfileAdmin } from "@/context/ProfileAdminContext";
import { useAppLock } from "@/context/AppLockContext";
import {
  isValidPinFormat,
  normalizePasscode,
  PASSCODE_MAX_LEN,
  PASSCODE_REQUIREMENTS,
} from "@/lib/appLock";
import { siteOrigin } from "@/lib/env";
import { fetchPickupStanding } from "@/lib/siteApi";
import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  tier: string | null;
  tier_rank: number | null;
  approved: boolean | null;
  instagram: string | null;
  phone: string | null;
  playing_position: string | null;
  username: string | null;
};

const TIER_RANK_LABELS: Record<number, string> = {
  1: "Tier 1A",
  2: "Tier 1B",
  3: "Tier 2",
  4: "Tier 3",
  5: "Tier 4",
  6: "Public",
};

function tierLabel(tier: string | null, tierRank: number | null): string | null {
  if (tier && String(tier).trim()) return String(tier).trim();
  if (tierRank == null) return null;
  return TIER_RANK_LABELS[tierRank] ?? `Tier rank ${tierRank}`;
}

function cleanInstagram(s: string): string {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

function fullName(p: ProfileRow | null): string | null {
  if (!p) return null;
  const a = (p.first_name ?? "").trim();
  const b = (p.last_name ?? "").trim();
  const joined = `${a} ${b}`.trim();
  return joined || null;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const v = value != null && String(value).trim() ? String(value).trim() : null;
  if (!v) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{v}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { replay: replayAccountIntro } = useAccountIntroReplay();
  const replayOpeningThemeCtx = useReplayOpeningTheme();
  const { session, supabase, isReady, signOut } = useAuth();
  const { enabled: adminModeEnabled, isReady: adminModeReady, setEnabled: setAdminModeEnabled } = useAdminMode();
  const { isAdmin, isReady: profileAdminReady } = useProfileAdmin();
  const {
    hasPin,
    changePin,
    biometricsEnabled,
    biometricsAvailable,
    setBiometricsEnabled,
    refreshBiometricAvailability,
    lockNow,
  } = useAppLock();

  const [lockUi, setLockUi] = useState<"idle" | "change">("idle");
  const [changeOld, setChangeOld] = useState("");
  const [changeNewA, setChangeNewA] = useState("");
  const [changeNewB, setChangeNewB] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPlayingPosition, setEditPlayingPosition] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editOk, setEditOk] = useState(false);

  const [waiverAccepted, setWaiverAccepted] = useState<boolean | null>(null);
  const [waiverVersion, setWaiverVersion] = useState<string | null>(null);
  const [waiverLoading, setWaiverLoading] = useState(true);

  const [reliabilityLoading, setReliabilityLoading] = useState(true);
  const [reliabilityLabel, setReliabilityLabel] = useState<string | null>(null);
  const [reliabilityScorePct, setReliabilityScorePct] = useState<number | null>(null);
  const [reliabilitySubtext, setReliabilitySubtext] = useState<string | null>(null);

  useEffect(() => {
    void refreshBiometricAvailability();
  }, [refreshBiometricAvailability]);

  const userId = session?.user?.id ?? null;
  const accessToken = session?.access_token ?? null;

  const loadProfile = useCallback(async () => {
    if (!supabase || !userId) {
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    setProfileErr(null);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "first_name,last_name,tier,tier_rank,approved,instagram,phone,playing_position,username",
      )
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      setProfileErr(error.message);
      setProfile(null);
    } else {
      setProfile((data as ProfileRow | null) ?? null);
    }
    setProfileLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    if (!isReady) return;
    void loadProfile();
  }, [isReady, loadProfile]);

  useEffect(() => {
    if (!profile) return;
    setEditFirstName(String(profile.first_name ?? ""));
    setEditLastName(String(profile.last_name ?? ""));
    setEditPlayingPosition(String(profile.playing_position ?? ""));
    setEditInstagram(profile.instagram ? String(profile.instagram).replace(/^@/, "") : "");
    setEditPhone(String(profile.phone ?? ""));
    setEditUsername(String(profile.username ?? ""));
  }, [profile]);

  useEffect(() => {
    if (!isReady) return;
    const origin = siteOrigin();
    if (!origin || !accessToken) {
      setWaiverLoading(false);
      setWaiverAccepted(null);
      setWaiverVersion(null);
      return;
    }
    let cancelled = false;
    setWaiverLoading(true);
    void (async () => {
      try {
        const r = await fetch(`${origin}/api/waiver/status`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
        });
        const j = (await r.json().catch(() => null)) as
          | { accepted?: boolean; currentVersion?: string }
          | null;
        if (cancelled) return;
        if (!r.ok || !j) {
          setWaiverAccepted(null);
          setWaiverVersion(null);
        } else {
          setWaiverAccepted(Boolean(j.accepted));
          setWaiverVersion(typeof j.currentVersion === "string" ? j.currentVersion : null);
        }
      } catch {
        if (!cancelled) {
          setWaiverAccepted(null);
          setWaiverVersion(null);
        }
      } finally {
        if (!cancelled) setWaiverLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, accessToken]);

  useEffect(() => {
    if (!isReady) return;
    if (!accessToken) {
      setReliabilityLoading(false);
      setReliabilityLabel(null);
      setReliabilityScorePct(null);
      setReliabilitySubtext(null);
      return;
    }
    let cancelled = false;
    setReliabilityLoading(true);
    void (async () => {
      const r = await fetchPickupStanding(accessToken);
      if (cancelled) return;
      if (r.ok && r.data?.ok && r.data.reliability) {
        const rel = r.data.reliability;
        setReliabilityLabel(rel.user_label ?? null);
        setReliabilityScorePct(rel.score_pct == null ? null : Math.round(Number(rel.score_pct)));
        setReliabilitySubtext(rel.user_subtext ?? null);
      } else {
        setReliabilityLabel(null);
        setReliabilityScorePct(null);
        setReliabilitySubtext(null);
      }
      setReliabilityLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, accessToken]);

  async function onSaveProfile() {
    if (!supabase || !userId) return;
    setEditMsg(null);
    setEditOk(false);

    const firstName = editFirstName.trim();
    const lastName = editLastName.trim();
    const playingPosition = editPlayingPosition.trim();
    const instagram = cleanInstagram(editInstagram);
    const phone = editPhone.trim();
    const username = editUsername.trim();

    setEditBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        playing_position: playingPosition || null,
        instagram: instagram || null,
        phone: phone || null,
        username: username || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    setEditBusy(false);

    if (error) {
      const code = (error as { code?: string }).code;
      const dup =
        code === "23505" ||
        /profiles_username_lower_unique|duplicate key/i.test(error.message ?? "");
      setEditMsg(dup ? "That username is already taken. Try another." : error.message);
      return;
    }

    setProfile((p) =>
      p
        ? {
            ...p,
            first_name: firstName || null,
            last_name: lastName || null,
            playing_position: playingPosition || null,
            instagram: instagram || null,
            phone: phone || null,
            username: username || null,
          }
        : p,
    );
    setEditOk(true);
    setEditMsg("Saved.");
  }

  async function onToggleBiometrics(next: boolean) {
    setLockMsg(null);
    if (!next) {
      await setBiometricsEnabled(false);
      return;
    }
    if (!biometricsAvailable) {
      setLockMsg("Biometrics aren’t available on this device.");
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: "Turn on Face ID for CT Pickup",
      cancelLabel: "Cancel",
    });
    if (r.success) await setBiometricsEnabled(true);
  }

  if (!isReady || !profileAdminReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  const signedEmail = session?.user?.email;
  if (!signedEmail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.sub}>
          Email sign-in, push, and your device passcode{"\n"}
          (same one-time email code Supabase sends you).
        </Text>

        <View style={[styles.card, styles.cardLime]}>
          <Text style={styles.signedLabel}>SIGNED IN</Text>
          <Text style={styles.email}>{signedEmail}</Text>
          <Text style={styles.signedAssist}>You&apos;re signed in on this device. Push reminders use your account.</Text>
          <Pressable style={styles.outlineBtnLime} onPress={() => void signOut()}>
            <Text style={styles.outlineBtnLimeText}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Profile</Text>
        <Text style={styles.sectionSub}>Your roster info from CT Pickup.</Text>

        <View style={styles.card}>
          {profileLoading ? (
            <View style={styles.cardLoadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.cardLoadingText}>Loading profile…</Text>
            </View>
          ) : profileErr ? (
            <Text style={styles.cardError}>{profileErr}</Text>
          ) : !profile ? (
            <Text style={styles.cardMuted}>No profile found.</Text>
          ) : (
            <>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusPill,
                    profile.approved ? styles.statusPillGreen : styles.statusPillAmber,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      profile.approved ? styles.statusPillTextGreen : styles.statusPillTextAmber,
                    ]}
                  >
                    {profile.approved ? "Approved" : "Pending approval"}
                  </Text>
                </View>
              </View>
              <InfoRow label="Full name" value={fullName(profile)} />
              <InfoRow label="Username" value={profile.username} />
              <InfoRow label="Playing position" value={profile.playing_position} />
              <InfoRow
                label="Instagram"
                value={profile.instagram ? `@${String(profile.instagram).replace(/^@/, "")}` : null}
              />
              <InfoRow label="Phone" value={profile.phone} />
              <InfoRow label="Tier" value={tierLabel(profile.tier, profile.tier_rank)} />
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Edit profile</Text>
        <Text style={styles.sectionSub}>Update your roster details. Saved instantly.</Text>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>First name</Text>
          <TextInput
            style={styles.input}
            value={editFirstName}
            onChangeText={setEditFirstName}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder="First name"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!editBusy}
          />

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Last name</Text>
          <TextInput
            style={styles.input}
            value={editLastName}
            onChangeText={setEditLastName}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder="Last name"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!editBusy}
          />

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Playing position</Text>
          <TextInput
            style={styles.input}
            value={editPlayingPosition}
            onChangeText={setEditPlayingPosition}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder="e.g. Midfielder"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!editBusy}
          />

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Instagram</Text>
          <TextInput
            style={styles.input}
            value={editInstagram}
            onChangeText={setEditInstagram}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="@handle"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!editBusy}
          />

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Phone</Text>
          <TextInput
            style={styles.input}
            value={editPhone}
            onChangeText={setEditPhone}
            keyboardType="phone-pad"
            autoCorrect={false}
            placeholder="Phone number"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!editBusy}
          />

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Username</Text>
          <TextInput
            style={styles.input}
            value={editUsername}
            onChangeText={setEditUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="username"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!editBusy}
          />

          <Pressable
            style={[styles.primaryBtn, editBusy && styles.disabled]}
            disabled={editBusy}
            onPress={() => void onSaveProfile()}
          >
            <Text style={styles.primaryBtnText}>{editBusy ? "Saving…" : "Save profile"}</Text>
          </Pressable>
          {editMsg ? (
            <Text style={[styles.msg, editOk ? styles.msgOk : styles.msgMuted]}>{editMsg}</Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Waiver</Text>
        <View style={styles.card}>
          {waiverLoading ? (
            <View style={styles.cardLoadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.cardLoadingText}>Checking waiver…</Text>
            </View>
          ) : waiverAccepted ? (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.statusPill, styles.statusPillGreen]}>
                  <Text style={[styles.statusPillText, styles.statusPillTextGreen]}>
                    Waiver accepted
                  </Text>
                </View>
              </View>
              {waiverVersion ? (
                <Text style={styles.cardSubtle}>Version {waiverVersion}</Text>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.statusPill, styles.statusPillAmber]}>
                  <Text style={[styles.statusPillText, styles.statusPillTextAmber]}>
                    Waiver required
                  </Text>
                </View>
              </View>
              <Text style={styles.cardSubtle}>
                Sign the liability waiver to RSVP for pickup and tournaments.
              </Text>
              <Pressable
                style={styles.outlineBtnLime}
                onPress={() => router.push("/waiver")}
              >
                <Text style={styles.outlineBtnLimeText}>Sign waiver</Text>
              </Pressable>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Reliability</Text>
        <View style={styles.card}>
          {reliabilityLoading ? (
            <View style={styles.cardLoadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.cardLoadingText}>Loading score…</Text>
            </View>
          ) : reliabilityLabel == null && reliabilityScorePct == null ? (
            <Text style={styles.cardMuted}>Reliability score isn’t available yet.</Text>
          ) : (
            <>
              <View style={styles.reliabilityHeader}>
                <Text style={styles.reliabilityLabel}>{reliabilityLabel ?? "Reliability"}</Text>
                {reliabilityScorePct != null ? (
                  <View style={styles.scorePill}>
                    <Text style={styles.scorePillText}>{reliabilityScorePct}%</Text>
                  </View>
                ) : null}
              </View>
              {reliabilitySubtext ? (
                <Text style={styles.cardSubtle}>{reliabilitySubtext}</Text>
              ) : null}
            </>
          )}
        </View>

        {isAdmin ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabelStrong}>Admin Mode</Text>
                <Text style={styles.bioHint}>Show the Admin tab and pages on this device.</Text>
              </View>
              <Switch
                value={adminModeEnabled}
                onValueChange={(v) => void setAdminModeEnabled(v)}
                disabled={!adminModeReady}
                trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
                thumbColor="#f4f4f5"
              />
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>App passcode</Text>
        <Text style={styles.sectionSub}>
          A passcode is required on this device when you’re{"\n"}
          signed in. {PASSCODE_REQUIREMENTS} It locks the app when you leave{"\n"}
          Face ID or Touch ID can unlock instead.
        </Text>

        {!hasPin ? (
          <Text style={styles.noteMuted}>
            You’ll be prompted to create your passcode after sign-in before using the app.
          </Text>
        ) : null}

        {hasPin && lockUi === "idle" ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabelStrong}>Face ID / Touch ID</Text>
                <Text style={styles.bioHint}>Unlock without typing your passcode.</Text>
              </View>
              <Switch
                value={biometricsEnabled}
                onValueChange={(v) => void onToggleBiometrics(v)}
                disabled={!biometricsAvailable && !biometricsEnabled}
                trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
                thumbColor="#f4f4f5"
              />
            </View>
            {!biometricsAvailable ? <Text style={styles.warn}>Set up Face ID or Touch ID in iOS Settings to use this.</Text> : null}
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                setLockUi("change");
                setLockMsg(null);
              }}
            >
              <Text style={styles.secondaryBtnText}>Change passcode</Text>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={() => lockNow()}>
              <Text style={styles.textBtnLabel}>Lock app now</Text>
            </Pressable>
          </View>
        ) : null}

      {hasPin && lockUi === "change" ? (
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Current passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={changeOld}
            onChangeText={(t) => setChangeOld(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>New passcode</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={changeNewA}
            onChangeText={(t) => setChangeNewA(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Confirm new</Text>
          <TextInput
            style={styles.input}
            maxLength={PASSCODE_MAX_LEN}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={changeNewB}
            onChangeText={(t) => setChangeNewB(t.slice(0, PASSCODE_MAX_LEN))}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <Pressable
            style={[styles.primaryBtn, lockBusy && styles.disabled]}
            disabled={lockBusy}
            onPress={() => {
              void (async () => {
                setLockMsg(null);
                if (!normalizePasscode(changeOld)) {
                  setLockMsg("Enter your current passcode.");
                  return;
                }
                if (!isValidPinFormat(changeNewA) || !isValidPinFormat(changeNewB)) {
                  setLockMsg(PASSCODE_REQUIREMENTS);
                  return;
                }
                if (normalizePasscode(changeNewA) !== normalizePasscode(changeNewB)) {
                  setLockMsg("New passcodes don’t match.");
                  return;
                }
                setLockBusy(true);
                const ok = await changePin(changeOld, changeNewA);
                setLockBusy(false);
                if (!ok) {
                  setLockMsg("Current passcode incorrect.");
                  return;
                }
                setChangeOld("");
                setChangeNewA("");
                setChangeNewB("");
                setLockUi("idle");
              })();
            }}
          >
            <Text style={styles.primaryBtnText}>Update passcode</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={() => { setLockUi("idle"); setLockMsg(null); }}>
            <Text style={styles.textBtnLabel}>Cancel</Text>
          </Pressable>
          {lockMsg ? <Text style={styles.msg}>{lockMsg}</Text> : null}
        </View>
      ) : null}

      {__DEV__ ? (
        <>
          <Pressable
            style={styles.devReplayRow}
            onPress={() => {
              void replayAccountIntro();
            }}
          >
            <Text style={styles.devReplayText}>Replay Account intro (dev only)</Text>
          </Pressable>
          <Pressable
            style={[styles.devReplayRow, styles.devReplayRowGap]}
            onPress={() => void replayOpeningThemeCtx?.replayOpeningTheme()}
          >
            <Text style={styles.devReplayText}>Replay opening theme (dev only)</Text>
          </Pressable>
        </>
      ) : null}
        <Pressable style={styles.aboutRow} onPress={() => {}}>
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="info-circle" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>About this app</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const LIME = "#a3e635";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" },
  title: { fontSize: 36, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  sub: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  sectionTitle: { marginTop: 28, fontSize: 20, fontWeight: "800", color: "#fff" },
  sectionAboveAuth: { marginTop: 20 },
  sectionSub: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
  noteMuted: { marginTop: 14, color: "rgba(255,255,255,0.45)", fontSize: 14, lineHeight: 20 },
  infoBanner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.35)",
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  infoBannerText: { color: "rgba(226,232,240,0.95)", fontSize: 14, lineHeight: 20 },
  segmentRow: { flexDirection: "row", marginTop: 12, gap: 10 },
  segmentChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  segmentChipActive: { borderColor: "rgba(255,255,255,0.32)", backgroundColor: "rgba(255,255,255,0.1)" },
  segmentChipText: { color: "rgba(255,255,255,0.5)", fontSize: 15, fontWeight: "600" },
  segmentChipTextActive: { color: "#fff" },
  signupExplainTitle: { fontSize: 17, fontWeight: "700", color: "#fff", marginBottom: 8 },
  mutedP: { color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 21, marginBottom: 16 },
  stepSubtitle: {
    marginBottom: 14,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
  },
  trustLine: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 18 },
  configBox: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(251,146,60,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,146,60,0.35)",
  },
  configBoxYellow: { marginBottom: 16 },
  configBoxTitle: { fontWeight: "700", color: "#fcd34d", marginBottom: 8, fontSize: 15 },
  configBoxBody: { color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 20 },
  configBody: { color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 20 },
  configMono: {
    marginTop: 10,
    marginBottom: 6,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined }),
    fontSize: 13,
    color: "rgba(255,255,255,0.9)",
    lineHeight: 20,
  },
  outlineSignupBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.55)",
    backgroundColor: "rgba(147,197,253,0.08)",
  },
  outlineSignupBtnText: { color: "#93c5fd", fontWeight: "600", fontSize: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  bioHint: { marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.5)" },
  warn: { marginTop: 8, fontSize: 13, color: "#fcd34d" },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
  },
  secondaryBtnText: { color: "#e5e5e5", fontWeight: "600", fontSize: 15 },
  devReplayRow: {
    marginTop: 20,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(250,204,21,0.35)",
    backgroundColor: "rgba(250,204,21,0.06)",
  },
  devReplayText: { fontSize: 13, color: "rgba(253,224,71,0.85)", fontWeight: "600" },
  devReplayRowGap: { marginTop: 12 },
  card: {
    marginTop: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  cardLime: {
    borderColor: "rgba(163,230,53,0.25)",
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  signedLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: LIME,
    letterSpacing: 1.2,
  },
  email: { marginTop: 10, fontSize: 18, fontWeight: "700", color: "#fff" },
  signedAssist: { marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 20 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.55)" },
  fieldLabelStrong: { fontSize: 13, fontWeight: "800", color: "rgba(255,255,255,0.75)" },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: "#f5f5f5",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#111", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  outlineBtnLime: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.55)",
    backgroundColor: "rgba(163,230,53,0.08)",
    alignItems: "center",
  },
  outlineBtnLimeText: { color: LIME, fontWeight: "700", fontSize: 15 },
  textBtn: { marginTop: 12, alignItems: "center" },
  textBtnLabel: { color: "rgba(255,255,255,0.55)", fontSize: 14 },
  textBtnLabelStrong: { color: "#93c5fd", fontSize: 15, fontWeight: "600" },
  msg: { marginTop: 14, color: "#fca5a5", fontSize: 14 },
  msgMuted: { color: "rgba(252,211,212,0.92)" },
  msgOk: { color: LIME },

  cardLoadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardLoadingText: { color: "rgba(255,255,255,0.7)", fontSize: 14 },
  cardMuted: { color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20 },
  cardError: { color: "#fca5a5", fontSize: 14, lineHeight: 20 },
  cardSubtle: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },

  infoRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.45)",
  },
  infoValue: { marginTop: 4, fontSize: 15, color: "rgba(255,255,255,0.95)", lineHeight: 22 },

  statusRow: { flexDirection: "row", marginBottom: 12 },
  statusPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillGreen: {
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  statusPillAmber: {
    borderColor: "rgba(252,211,77,0.45)",
    backgroundColor: "rgba(252,211,77,0.12)",
  },
  statusPillText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  statusPillTextGreen: { color: LIME },
  statusPillTextAmber: { color: "#fcd34d" },

  reliabilityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  reliabilityLabel: { color: "#fff", fontSize: 16, fontWeight: "700", flexShrink: 1 },
  scorePill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  scorePillText: { color: LIME, fontSize: 14, fontWeight: "800", letterSpacing: 0.4 },

  aboutRow: {
    marginTop: 16,
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
  aboutLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  aboutText: { fontSize: 15, fontWeight: "700", color: "rgba(255,255,255,0.9)" },
});
