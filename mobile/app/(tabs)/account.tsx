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
import { getNearestVenues, getNearestVenuesFromApi, type VenueDistanceRow } from "@/lib/venueDistance";
import { fetchPickupStanding, postMobilePushPreference, postMobilePushToken } from "@/lib/siteApi";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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

const POSITION_OPTIONS = [
  { value: "Goalkeeper" as const, label: "Goalkeeper" },
  { value: "Defender" as const, label: "Defender" },
  { value: "Midfielder" as const, label: "Midfielder" },
  { value: "Attacker" as const, label: "Attacker" },
];

type PositionValue = (typeof POSITION_OPTIONS)[number]["value"];

function labelFor<T extends { value: string; label: string }>(options: readonly T[], value: string | null): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

type SelectModalProps<T extends string> = {
  visible: boolean;
  title: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onSelect: (v: T) => void;
  onClose: () => void;
};

function SelectModal<T extends string>({ visible, title, options, value, onSelect, onClose }: SelectModalProps<T>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close picker" />
        <View style={styles.modalCardWrap} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>
            {options.map((opt) => {
              const selected = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    onSelect(opt.value);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.modalRow,
                    selected && styles.modalRowSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.modalRowText, selected && styles.modalRowTextSelected]}>{opt.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={onClose} style={({ pressed }) => [styles.modalCancel, pressed && { opacity: 0.85 }]}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  approved: boolean | null;
  instagram: string | null;
  phone: string | null;
  zip_code: string | null;
  playing_position: string | null;
  username: string | null;
  push_notifications_enabled: boolean | null;
};

function cleanInstagram(s: string): string {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

function formatProfileSaveError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const o = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint].filter((s) => typeof s === "string" && s.trim());
    if (parts.length) return parts.join(" — ");
    if (o.code) return `Error code ${o.code}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
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

  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPlayingPosition, setEditPlayingPosition] = useState<PositionValue | null>(null);
  const [editInstagram, setEditInstagram] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editZipCode, setEditZipCode] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editOk, setEditOk] = useState(false);
  const [positionPickerOpen, setPositionPickerOpen] = useState(false);

  const [waiverAccepted, setWaiverAccepted] = useState<boolean | null>(null);
  const [waiverVersion, setWaiverVersion] = useState<string | null>(null);
  const [waiverLoading, setWaiverLoading] = useState(true);

  const [reliabilityLoading, setReliabilityLoading] = useState(true);
  const [reliabilityLabel, setReliabilityLabel] = useState<string | null>(null);
  const [reliabilityScorePct, setReliabilityScorePct] = useState<number | null>(null);
  const [reliabilitySubtext, setReliabilitySubtext] = useState<string | null>(null);

  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);

  const [pushEnabled, setPushEnabled] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    void refreshBiometricAvailability();
  }, [refreshBiometricAvailability]);

  const accessToken = session?.access_token ?? null;

  const loadProfile = useCallback(async () => {
    const uid = session?.user?.id;
    if (!isReady || !supabase || !uid) {
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "first_name,last_name,approved,instagram,phone,zip_code,playing_position,username,push_notifications_enabled",
      )
      .eq("id", uid)
      .maybeSingle();
    if (error) {
      setProfile(null);
    } else {
      setProfile((data as ProfileRow | null) ?? null);
    }
  }, [isReady, supabase, session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  // Re-fetch when auth/session becomes available after focus (useFocusEffect does not re-run when loadProfile's deps update).
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!profile) return;
    setEditFirstName(String(profile.first_name ?? ""));
    setEditLastName(String(profile.last_name ?? ""));
    const rawPos = String(profile.playing_position ?? "").trim();
    setEditPlayingPosition(
      (POSITION_OPTIONS as readonly { value: string }[]).some((o) => o.value === rawPos) ? (rawPos as PositionValue) : null,
    );
    setEditInstagram(profile.instagram ? String(profile.instagram).replace(/^@/, "") : "");
    setEditPhone(String(profile.phone ?? ""));
    setEditZipCode(String(profile.zip_code ?? "").replace(/\D/g, "").slice(0, 5));
    setEditUsername(String(profile.username ?? ""));
    setPushEnabled(profile.push_notifications_enabled !== false);
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
    setEditMsg(null);
    setEditOk(false);

    if (!supabase) {
      setEditMsg("Supabase client is not available. Check app configuration.");
      return;
    }

    const authUserId = session?.user?.id;
    console.log("[save] authUserId:", authUserId, "session user id:", session?.user?.id);
    const userId = session?.user?.id;
    if (!userId) {
      setEditMsg("Not signed in.");
      return;
    }

    const firstName = editFirstName.trim();
    const lastName = editLastName.trim();
    const playingPosition = editPlayingPosition;
    const instagram = cleanInstagram(editInstagram);
    const phone = editPhone.trim();
    const zipDigits = editZipCode.replace(/\D/g, "").slice(0, 5);
    const username = editUsername.trim();

    const zipStored = zipDigits.length === 5 ? zipDigits : null;

    setEditBusy(true);
    try {
      let nearestVenues: VenueDistanceRow[] = [];
      if (zipStored) {
        const origin = siteOrigin();
        if (origin) {
          nearestVenues = await getNearestVenuesFromApi(zipStored, origin, accessToken);
        }
        if (nearestVenues.length === 0) {
          nearestVenues = getNearestVenues(zipStored);
        }
      }
      const nearestVenue = nearestVenues[0]?.venue ?? null;

      const { data, error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName || null,
          last_name: lastName || null,
          playing_position: playingPosition ?? null,
          instagram: instagram || null,
          phone: phone || null,
          zip_code: zipStored,
          nearest_venue: nearestVenue,
          username: username || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select("id");

      if (error) {
        console.log("[onSaveProfile] supabase.from('profiles').update error", error);
        const code = (error as { code?: string }).code;
        const dup =
          code === "23505" ||
          /profiles_username_lower_unique|duplicate key/i.test(error.message ?? "");
        setEditMsg(
          dup ? "That username is already taken. Try another." : formatProfileSaveError(error),
        );
        return;
      }

      if (!data?.length) {
        console.log("[onSaveProfile] update returned 0 rows", { userId });
        setEditMsg(
          "Save did not update any profile row (no match or not permitted). Your account may be missing a profile row.",
        );
        return;
      }

      setProfile((p) => {
        const nextFields = {
          first_name: firstName || null,
          last_name: lastName || null,
          playing_position: playingPosition ?? null,
          instagram: instagram || null,
          phone: phone || null,
          zip_code: zipDigits.length === 5 ? zipDigits : null,
          username: username || null,
        };
        if (p) {
          return { ...p, ...nextFields };
        }
        return {
          ...nextFields,
          approved: null,
          push_notifications_enabled: pushEnabled,
        };
      });
      setEditOk(true);
      setEditMsg("Saved.");
    } catch (e) {
      console.log("[onSaveProfile] exception", e);
      setEditMsg(formatProfileSaveError(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function onTogglePushNotifications(next: boolean) {
    if (pushBusy) return;
    setPushMsg(null);
    if (!supabase) {
      setPushMsg("Supabase client is not available. Check app configuration.");
      return;
    }
    if (!accessToken) {
      setPushMsg("Sign in again to change this.");
      return;
    }
    const uid = session?.user?.id;
    if (!uid) {
      setPushMsg("Sign in again to change this.");
      return;
    }

    const prev = pushEnabled;
    setPushEnabled(next);
    setPushBusy(true);
    try {
      let data: { id: string }[] | null = null;
      try {
        const res = await supabase
          .from("profiles")
          .update({
            push_notifications_enabled: next,
            updated_at: new Date().toISOString(),
          })
          .eq("id", uid)
          .select("id");
        data = res.data;
        const { error } = res;
        if (error) {
          console.log("[push-pref] profiles.update Supabase error:", error);
          console.log("[push-pref] profiles.update Supabase error JSON:", JSON.stringify(error));
          setPushEnabled(prev);
          setPushMsg(formatProfileSaveError(error));
          return;
        }
        if (!data?.length) {
          console.log("[push-pref] profiles.update returned 0 rows", { userId: uid });
          setPushEnabled(prev);
          setPushMsg(
            "Save did not update any profile row (no match or not permitted). Your account may be missing a profile row.",
          );
          return;
        }
      } catch (e) {
        console.log("[push-pref] profiles.update exception:", e);
        setPushEnabled(prev);
        setPushMsg(formatProfileSaveError(e));
        return;
      }

      setProfile((p) => (p ? { ...p, push_notifications_enabled: next } : p));

      if (!next) {
        try {
          const { error: delErr } = await supabase.from("user_push_devices").delete().eq("user_id", uid);
          if (delErr) {
            console.log("[push-pref] user_push_devices.delete Supabase error:", delErr);
            console.log("[push-pref] user_push_devices.delete Supabase error JSON:", JSON.stringify(delErr));
          }
        } catch (e) {
          console.log("[push-pref] user_push_devices.delete exception:", e);
        }
        try {
          const res = await postMobilePushPreference(accessToken, false);
          if (!res.ok) {
            console.log("[push-pref] postMobilePushPreference(false) failed:", res.error);
          }
        } catch (e) {
          console.log("[push-pref] postMobilePushPreference(false) exception:", e);
        }
      } else if (Device.isDevice) {
        try {
          const { status: existing } = await Notifications.getPermissionsAsync();
          let finalStatus = existing;
          if (existing !== "granted") {
            const req = await Notifications.requestPermissionsAsync();
            finalStatus = req.status;
          }
          if (finalStatus === "granted") {
            const projectId =
              Constants.expoConfig?.extra?.eas?.projectId ??
              Constants.easConfig?.projectId ??
              process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
            const tokenRes = await Notifications.getExpoPushTokenAsync(
              projectId ? { projectId: String(projectId) } : undefined,
            );
            const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;
            if (tokenRes?.data && platform) {
              const reg = await postMobilePushToken(accessToken, tokenRes.data, platform);
              if (!reg.ok) {
                console.log("[push-pref] postMobilePushToken failed:", reg.error);
              }
            }
          }
        } catch (e) {
          console.log("[push-pref] token re-register exception:", e);
        }
      }
    } finally {
      setPushBusy(false);
    }
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
      <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 200 }]}
          keyboardShouldPersistTaps="handled"
        >
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

        <Text style={styles.sectionTitle}>Edit profile</Text>

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
          <Pressable
            onPress={() => setPositionPickerOpen(true)}
            disabled={editBusy}
            style={({ pressed }) => [
              styles.input,
              styles.selectTrigger,
              pressed && !editBusy ? { opacity: 0.92 } : null,
              editBusy ? { opacity: 0.6 } : null,
            ]}
          >
            <Text style={editPlayingPosition ? styles.selectValue : styles.selectPlaceholder}>
              {editPlayingPosition ? labelFor(POSITION_OPTIONS, editPlayingPosition) : "Choose…"}
            </Text>
            <Text style={styles.selectChevron}>▾</Text>
          </Pressable>

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

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Zip code</Text>
          <TextInput
            style={styles.input}
            value={editZipCode}
            onChangeText={(t) => setEditZipCode(t.replace(/\D/g, "").slice(0, 5))}
            keyboardType="numeric"
            maxLength={5}
            autoCorrect={false}
            placeholder="5-digit zip"
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
            {editBusy ? (
              <View style={styles.saveBtnBusy}>
                <ActivityIndicator color="#111" />
                <Text style={styles.primaryBtnText}>Saving…</Text>
              </View>
            ) : (
              <Text style={styles.primaryBtnText}>Save profile</Text>
            )}
          </Pressable>
          {editMsg ? (
            <Text style={[styles.msg, editOk ? styles.msgOk : styles.msgMuted]}>{editMsg}</Text>
          ) : null}
        </View>

        <SelectModal<PositionValue>
          visible={positionPickerOpen}
          title="Playing position"
          options={POSITION_OPTIONS}
          value={editPlayingPosition}
          onSelect={setEditPlayingPosition}
          onClose={() => setPositionPickerOpen(false)}
        />

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

        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.fieldLabelStrong}>Push Notifications</Text>
              <Text style={styles.bioHint}>Receive updates about runs, chat, and announcements</Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={(v) => void onTogglePushNotifications(v)}
              disabled={pushBusy || !accessToken}
              trackColor={{ false: "rgba(255,255,255,0.18)", true: LIME }}
              thumbColor="#f4f4f5"
            />
          </View>
          {pushMsg ? <Text style={styles.msg}>{pushMsg}</Text> : null}
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

        {hasPin ? (
          <>
            <Text style={styles.sectionTitle}>App passcode</Text>
            <Text style={styles.sectionSub}>
              A passcode is required on this device when you’re{"\n"}
              signed in. {PASSCODE_REQUIREMENTS} It locks the app when you leave{"\n"}
              Face ID or Touch ID can unlock instead.
            </Text>

            {lockUi === "idle" ? (
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
                {!biometricsAvailable ? (
                  <Text style={styles.warn}>Set up Face ID or Touch ID in iOS Settings to use this.</Text>
                ) : null}
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
            ) : (
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
            )}
          </>
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
        <Pressable style={styles.aboutRow} onPress={() => (router.push as (href: string) => void)("/rules")}>
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="list-alt" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>Rules</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>
        <Pressable
          style={styles.aboutRow}
          onPress={() => (router.push as (href: string) => void)("/help")}
        >
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="question-circle" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>Help</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>
        <Pressable
          style={styles.aboutRow}
          onPress={() => (router.push as (href: string) => void)("/privacy-policy")}
        >
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="shield" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>Privacy Policy</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>

        <Pressable style={styles.aboutRow} onPress={() => (router.push as (href: string) => void)("/run-history")}>
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="history" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>Run history</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>
        <Pressable
          style={styles.aboutRow}
          onPress={() => {
            Alert.alert(
              "CT Pickup",
              "Version 1.0.0 — Competitive pickup soccer platform for CT, NY, NJ and MD. Built by CT Pickup LLC.",
            );
          }}
        >
          <View style={styles.aboutLeft}>
            <View style={styles.aboutIconWrap}>
              <FontAwesome name="info-circle" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.aboutText}>About this app</Text>
          </View>
          <FontAwesome name="chevron-right" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>

        <Text style={[styles.sectionTitle, styles.dangerSectionTitle]}>Danger zone</Text>
        <Text style={styles.sectionSub}>
          Permanently remove your account and associated data from CT Pickup.
        </Text>
        <Pressable
          style={[styles.deleteAccountBtn, deleteAccountBusy && styles.disabled]}
          disabled={deleteAccountBusy || !accessToken}
          onPress={() => {
            const origin = siteOrigin();
            if (!origin || !accessToken) {
              Alert.alert("Can’t delete account", "Missing server URL or session. Try again after signing in.");
              return;
            }
            Alert.alert(
              "Delete your account?",
              "This will permanently delete your account and all your data. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    void (async () => {
                      setDeleteAccountBusy(true);
                      try {
                        const r = await fetch(`${origin}/api/account/delete`, {
                          method: "DELETE",
                          headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${accessToken}`,
                          },
                          cache: "no-store",
                        });
                        if (!r.ok) {
                          const j = (await r.json().catch(() => null)) as { error?: string } | null;
                          Alert.alert(
                            "Couldn’t delete account",
                            typeof j?.error === "string" ? j.error : "Something went wrong. Try again later.",
                          );
                          return;
                        }
                        await signOut();
                        router.replace("/login");
                      } catch {
                        Alert.alert("Couldn’t delete account", "Check your connection and try again.");
                      } finally {
                        setDeleteAccountBusy(false);
                      }
                    })();
                  },
                },
              ],
            );
          }}
        >
          {deleteAccountBusy ? (
            <View style={styles.deleteAccountBtnBusy}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.deleteAccountBtnText}>Deleting…</Text>
            </View>
          ) : (
            <Text style={styles.deleteAccountBtnText}>Delete account</Text>
          )}
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectPlaceholder: {
    fontSize: 16,
    color: "rgba(255,255,255,0.35)",
  },
  selectValue: {
    fontSize: 16,
    color: "#fff",
  },
  selectChevron: {
    fontSize: 14,
    color: LIME,
    marginLeft: 8,
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: "#f5f5f5",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#111", fontWeight: "700", fontSize: 16 },
  saveBtnBusy: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  cardSubtle: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },

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

  dangerSectionTitle: { marginTop: 32, color: "#fca5a5" },
  deleteAccountBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#dc2626",
  },
  deleteAccountBtnBusy: { flexDirection: "row", alignItems: "center", gap: 10 },
  deleteAccountBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  modalRoot: { flex: 1 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  modalCardWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: "#141414",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.25)",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: LIME,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginHorizontal: 4,
  },
  modalRowSelected: { backgroundColor: "rgba(163,230,53,0.12)" },
  modalRowText: { fontSize: 16, color: "rgba(255,255,255,0.85)" },
  modalRowTextSelected: { color: LIME, fontWeight: "700" },
  modalCancel: { marginTop: 4, paddingVertical: 14, alignItems: "center" },
  modalCancelText: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
});
