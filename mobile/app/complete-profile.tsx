import { StarLevelSelect } from "@/components/StarLevels";
import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useProfilePhoto } from "@/context/ProfilePhotoContext";
import ProfilePhotoPicker from "@/components/photo/ProfilePhotoPicker";
import { PHOTO_STEP_BODY, PHOTO_STEP_TITLE } from "@shared/profilePhoto";
import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import { siteOrigin } from "@/lib/env";
import {
  normalizeProfileUsername,
  PROFILE_USERNAME_MAX_LEN,
  USERNAME_TAKEN_USER_MESSAGE,
} from "@/lib/profileIdentityFields";
import { INSTAGRAM_VERIFICATION_HANDLE } from "@/lib/brand";
import { applyReferralCode } from "@/lib/referralApi";
import { allocateUniqueProfileUsername } from "@/lib/profileUsernameAllocate";
import { COMPLETE_PROFILE_ZIP_NO_VENUE_MSG } from "@/lib/playerLocationHints";
import { getNearestVenues, getNearestVenuesFromApi, type VenueDistanceRow } from "@/lib/venueDistance";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Redirect, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { headline, themeColor, useThemedStyles } from "@/theme";
const GENDER_OPTIONS = [
  { value: "male" as const, label: "Male" },
  { value: "female" as const, label: "Female" },
  { value: "other" as const, label: "Other" },
  { value: "prefer_not_to_say" as const, label: "Prefer not to say" },
];

const POSITION_OPTIONS = [
  { value: "Goalkeeper" as const, label: "Goalkeeper" },
  { value: "Defender" as const, label: "Defender" },
  { value: "Midfielder" as const, label: "Midfielder" },
  { value: "Attacker" as const, label: "Attacker" },
];

type GenderValue = (typeof GENDER_OPTIONS)[number]["value"];
type PositionValue = (typeof POSITION_OPTIONS)[number]["value"];

type FieldKey =
  | "first_name"
  | "last_name"
  | "gender"
  | "playing_position"
  | "stated_level"
  | "instagram"
  | "phone"
  | "zip_code"
  | "username";

function cleanInstagram(s: string): string {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

function labelFor<T extends { value: string; label: string }>(options: readonly T[], value: string | null): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

const NEAREST_STATE_ORDER = ["CT", "NY", "NJ", "MD"] as const;
const NEAREST_UNDER_MINUTES = 45;

function stateCodeFromVenueAddress(address: string): (typeof NEAREST_STATE_ORDER)[number] | null {
  const m = address.match(/\b(CT|NY|NJ|MD)\b/);
  return m && (NEAREST_STATE_ORDER as readonly string[]).includes(m[1])
    ? (m[1] as (typeof NEAREST_STATE_ORDER)[number])
    : null;
}

function nearestVenueSections(rows: VenueDistanceRow[]): { header: string; venues: VenueDistanceRow[] }[] {
  if (rows.length === 0) return [];

  const anyUnder45 = rows.some((r) => r.estimatedMinutes < NEAREST_UNDER_MINUTES);
  const byState = new Map<string, VenueDistanceRow[]>();

  for (const row of rows) {
    const code = stateCodeFromVenueAddress(row.address) ?? "OTHER";
    const bucket = byState.get(code) ?? [];
    bucket.push(row);
    byState.set(code, bucket);
  }

  for (const [, list] of byState) {
    list.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
  }

  if (anyUnder45) {
    for (const [code, list] of byState) {
      const filtered = list.filter((r) => r.estimatedMinutes < NEAREST_UNDER_MINUTES);
      if (filtered.length) {
        byState.set(code, filtered);
      } else {
        byState.delete(code);
      }
    }
  }

  const out: { header: string; venues: VenueDistanceRow[] }[] = [];

  for (const code of NEAREST_STATE_ORDER) {
    const venues = byState.get(code);
    if (!venues?.length) continue;
    out.push({ header: code, venues });
  }

  return out;
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
  useThemedStyles(publish_styles);

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

export default function CompleteProfileScreen() {
  useThemedStyles(publish_styles);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, supabase, isReady } = useAuth();
  const { waiverAccepted, waiverLoading } = useWaiver();
  const { markProfileComplete, profileGateLoading, profileNeedsCompletion } = useProfileCompletionGate();
  const isIPad = Platform.OS === "ios" && Platform.isPad;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<GenderValue | null>(null);
  const [playingPosition, setPlayingPosition] = useState<PositionValue | null>(null);
  const [statedLevel, setStatedLevel] = useState<number | null>(null);
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [username, setUsername] = useState("");
  const usernameUserEdited = useRef(false);

  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  const [positionPickerOpen, setPositionPickerOpen] = useState(false);

  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postSaveVenues, setPostSaveVenues] = useState<VenueDistanceRow[] | null>(null);
  const [photoStepDone, setPhotoStepDone] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [igStepSkipped, setIgStepSkipped] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  /** Set when a typed code could not be applied; shown after the save and never blocks it. */
  const [referralNote, setReferralNote] = useState<string | null>(null);
  const {
    required: photoRequired,
    avatarUrl,
    hasPhoto,
    setAvatarUrl,
    dismissNudge,
  } = useProfilePhoto();
  const [zipVenuePreviewChecking, setZipVenuePreviewChecking] = useState(false);
  const [zipVenuePreviewEmpty, setZipVenuePreviewEmpty] = useState<boolean | null>(null);

  const signedEmail = session?.user?.email ?? "";

  const zipDigits = zipCode.replace(/\D/g, "").slice(0, 5);
  const zipOk = zipDigits.length === 5;

  useEffect(() => {
    if (!zipOk || postSaveVenues !== null) {
      setZipVenuePreviewEmpty(null);
      setZipVenuePreviewChecking(false);
      return;
    }
    setZipVenuePreviewEmpty(null);
    let cancelled = false;
    const tid = setTimeout(() => {
      void (async () => {
        setZipVenuePreviewChecking(true);
        let rows: VenueDistanceRow[] = [];
        try {
          const origin = siteOrigin();
          if (origin) {
            rows = await getNearestVenuesFromApi(zipDigits, origin, session?.access_token);
          }
          if (rows.length === 0) {
            rows = getNearestVenues(zipDigits);
          }
        } catch {
          rows = [];
        }
        if (cancelled) return;
        setZipVenuePreviewChecking(false);
        setZipVenuePreviewEmpty(rows.length === 0);
      })();
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
  }, [zipOk, zipDigits, postSaveVenues, session?.access_token]);

  useEffect(() => {
    if (usernameUserEdited.current) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    const uid = session?.user?.id;
    if (!fn || !ln || !supabase || !uid) return;
    let cancelled = false;
    const tid = setTimeout(() => {
      void (async () => {
        try {
          const suggestion = await allocateUniqueProfileUsername(supabase, fn, ln, uid);
          if (cancelled) return;
          setUsername(suggestion);
        } catch (e) {
          console.error("[complete-profile] username suggestion failed", e);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
  }, [firstName, lastName, supabase, session?.user?.id]);

  const canContinue = useMemo(() => {
    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !playingPosition ||
      statedLevel == null ||
      !zipOk ||
      !username.trim()
    )
      return false;
    return true;
  }, [firstName, lastName, playingPosition, statedLevel, zipOk, username]);

  const liveErrors = useMemo((): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!firstName.trim()) e.first_name = "Required";
    if (!lastName.trim()) e.last_name = "Required";
    if (!playingPosition) e.playing_position = "Required";
    if (statedLevel == null) e.stated_level = "Required";
    if (!zipDigits) e.zip_code = "Required";
    else if (!zipOk) e.zip_code = "Enter a 5-digit zip";
    if (!username.trim()) e.username = "Required";
    else if (!normalizeProfileUsername(username))
      e.username = "3–30 characters, lowercase letters and numbers only";
    return e;
  }, [firstName, lastName, playingPosition, statedLevel, zipDigits, zipOk, username]);

  const postSaveVenueSections = useMemo(
    () => (postSaveVenues && postSaveVenues.length > 0 ? nearestVenueSections(postSaveVenues) : []),
    [postSaveVenues],
  );

  const firstLiveErrorMessage = useMemo(() => {
    const ordered: FieldKey[] = [
      "first_name",
      "last_name",
      "playing_position",
      "stated_level",
      "instagram",
      "zip_code",
      "username",
    ];
    for (const k of ordered) {
      const m = liveErrors[k];
      if (m) return m === "Required" ? "Please fill out all required fields." : m;
    }
    return null;
  }, [liveErrors]);

  const onContinue = useCallback(async () => {
    setSubmitError(null);
    setAgeError(null);
    if (!ageConfirmed) {
      const m = "You must be 13 or older to use Competitive Together";
      setAgeError(m);
      return;
    }
    if (!canContinue) {
      const m = firstLiveErrorMessage ?? "Please check the form and try again.";
      setSubmitError(m);
      Alert.alert("Missing info", m);
      console.error("[complete-profile] validation failed", {
        email: signedEmail,
        liveErrors,
      });
      return;
    }

    const fn = firstName.trim();
    const ln = lastName.trim();
    const pos = playingPosition;
    const ig = cleanInstagram(instagram);
    const ph = phone.trim() || null;
    const zc = zipDigits;
    const unNorm = normalizeProfileUsername(username.trim());
    if (!unNorm) {
      const m = "Username must be 3–30 characters, lowercase letters and numbers only.";
      setSubmitError(m);
      Alert.alert("Invalid username", m);
      return;
    }
    const un = unNorm;
    const userId = session?.user?.id;

    if (!supabase || !userId) {
      setSubmitError("Session expired. Please sign in again.");
      console.error("[complete-profile] missing supabase or userId", {
        hasSupabase: !!supabase,
        userId,
        email: signedEmail,
      });
      return;
    }

    setBusy(true);
    try {
      let nearestVenues: VenueDistanceRow[] = [];
      const origin = siteOrigin();
      try {
        if (origin) {
          nearestVenues = await getNearestVenuesFromApi(zc, origin, session?.access_token);
        }
        if (nearestVenues.length === 0) {
          nearestVenues = getNearestVenues(zc);
        }
      } catch (e) {
        console.error("[complete-profile] nearest venues lookup failed; continuing without venues", {
          error: e,
          zip: zc,
          origin,
          hasAccessToken: !!session?.access_token,
        });
        nearestVenues = [];
      }

      const payload: Record<string, unknown> = {
        first_name: fn,
        last_name: ln,
        gender: gender ?? null,
        playing_position: pos,
        instagram: ig,
        phone: ph,
        zip_code: zc,
        nearest_venue: nearestVenues[0]?.venue ?? null,
        username: un,
        email: signedEmail,
        updated_at: new Date().toISOString(),
      };

      try {
        const { error } = await supabase.from("profiles").update(payload).eq("id", userId);

        if (error) {
          const code = (error as { code?: string }).code;
          const dup =
            code === "23505" ||
            /profiles_username_lower_unique|duplicate key/i.test(error.message ?? "");
          const userMsg = dup ? USERNAME_TAKEN_USER_MESSAGE : "We couldn’t save your profile right now. Please try again.";
          setSubmitError(userMsg);
          Alert.alert("Couldn’t save profile", userMsg);
          console.error("[complete-profile] supabase profiles.update failed", {
            error,
            code,
            userId,
            email: signedEmail,
            payloadKeys: Object.keys(payload),
          });
          return;
        }
      } catch (e) {
        const userMsg = "We couldn’t save your profile right now. Please try again.";
        setSubmitError(userMsg);
        Alert.alert("Couldn’t save profile", userMsg);
        console.error("[complete-profile] supabase call threw", {
          error: e,
          userId,
          email: signedEmail,
        });
        return;
      }

      // Starting rating. The server decides whether to seed; a failure here never blocks signup.
      if (origin && session?.access_token && statedLevel != null) {
        try {
          const r = await fetch(`${origin}/api/account/star-level`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ level: statedLevel }),
          });
          if (!r.ok) console.warn("[complete-profile] star level not saved", r.status);
        } catch (e) {
          console.warn("[complete-profile] star level request failed", e);
        }
      }

      // Optional referral code: same call as Settings. A bad code only leaves a note; saving is already done.
      if (referralCode.trim()) {
        const res = await applyReferralCode(session?.access_token ?? null, referralCode);
        setReferralNote(res.ok ? null : `${res.error} You can try again later in Settings.`);
      }

      setPostSaveVenues(nearestVenues);
    } catch (e) {
      const userMsg = "Something went wrong while saving your profile. Please try again.";
      setSubmitError(userMsg);
      Alert.alert("Error", userMsg);
      console.error("[complete-profile] unexpected error", {
        error: e,
        userId: session?.user?.id,
        email: signedEmail,
      });
    } finally {
      setBusy(false);
    }
  }, [
    canContinue,
    firstLiveErrorMessage,
    firstName,
    lastName,
    gender,
    playingPosition,
    statedLevel,
    instagram,
    phone,
    zipDigits,
    username,
    signedEmail,
    liveErrors,
    ageConfirmed,
    session?.user?.id,
    session?.access_token,
    supabase,
    referralCode,
  ]);

  const onContinueToApp = useCallback(() => {
    markProfileComplete();
    router.replace("/(tabs)" as Href);
  }, [markProfileComplete, router]);

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  if (waiverLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (!waiverAccepted) {
    return <Redirect href="/waiver" />;
  }

  if (profileGateLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={themeColor().text} />
      </View>
    );
  }

  if (!profileNeedsCompletion) {
    return <Redirect href={"/(tabs)" as Href} />;
  }

  const btnLocked = !canContinue || busy;

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={styles.bgGlowA} />
      <View pointerEvents="none" style={styles.bgGlowB} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? (isIPad ? "height" : "padding") : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? (isIPad ? 0 : 8) : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(insets.top, 16) + 12,
              paddingBottom: 200,
            },
          ]}
        >
          {postSaveVenues && !photoStepDone && hasPhoto !== true ? (
            <>
              <Text style={styles.title}>{PHOTO_STEP_TITLE}</Text>
              <Text style={styles.subtitle}>{PHOTO_STEP_BODY}</Text>
              {referralNote ? <Text style={styles.referralNote}>{referralNote}</Text> : null}
              <View style={styles.photoStep}>
                <ProfilePhotoPicker
                  value={avatarUrl}
                  onSaved={(url) => {
                    setAvatarUrl(url);
                    setPhotoStepDone(true);
                  }}
                />
              </View>
              {photoRequired ? (
                <Text style={styles.photoStepHint}>You need a photo to continue.</Text>
              ) : (
                <Pressable
                  style={styles.photoSkip}
                  onPress={() => {
                    dismissNudge();
                    setPhotoStepDone(true);
                  }}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.photoSkipText}>Not now</Text>
                </Pressable>
              )}
            </>
          ) : postSaveVenues ? (
            <>
              <Text style={styles.title}>Profile saved</Text>
              <Text style={styles.subtitle}>You&apos;re ready to find pickup and events.</Text>
              {referralNote ? <Text style={styles.referralNote}>{referralNote}</Text> : null}

              <View style={styles.nearestCard}>
                <Text style={styles.nearestCardTitle}>Your nearest locations:</Text>
                {postSaveVenues.length === 0 ? (
                  <Text style={styles.nearestEmpty}>{COMPLETE_PROFILE_ZIP_NO_VENUE_MSG}</Text>
                ) : (
                  postSaveVenueSections.map((section, si) => (
                    <View key={section.header}>
                      <Text
                        style={[
                          styles.nearestSectionHeader,
                          si === 0 ? styles.nearestSectionHeaderFirst : styles.nearestSectionHeaderAfter,
                        ]}
                      >
                        {section.header}
                      </Text>
                      {section.venues.map((row, ri) => (
                        <View
                          key={`${section.header}-${row.venue}`}
                          style={[styles.nearestRow, ri === section.venues.length - 1 ? styles.nearestRowLast : null]}
                        >
                          <View style={styles.nearestRowLeft}>
                            <Text style={styles.nearestVenueName}>{row.venue}</Text>
                            <Text style={styles.nearestVenueAddress}>{row.address}</Text>
                          </View>
                          <Text style={styles.nearestEta}>~{row.estimatedMinutes} min</Text>
                        </View>
                      ))}
                    </View>
                  ))
                )}
              </View>

              {!igStepSkipped ? (
                <View style={styles.igStep}>
                  <Text style={styles.igTitle}>Get verified with Instagram (optional)</Text>
                  <Text style={styles.igBody}>Instagram: @{INSTAGRAM_VERIFICATION_HANDLE}</Text>
                  <View style={styles.igActions}>
                    <Pressable
                      style={styles.igSkip}
                      onPress={() => setIgStepSkipped(true)}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text style={styles.photoSkipText}>Skip</Text>
                    </Pressable>
                    <Pressable
                      style={styles.igGo}
                      onPress={() => router.push("/instagram-verification" as Href)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.igGoText}>Get verified</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <Pressable style={styles.primaryBtn} onPress={() => void onContinueToApp()}>
                <Text style={styles.primaryBtnText}>Continue</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Complete your profile</Text>
              <Text style={styles.subtitle}>We need a few details before you get started.</Text>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>First name</Text>
            <TextInput
              style={[styles.input, liveErrors.first_name ? styles.inputErr : null]}
              placeholder="First name"
              placeholderTextColor={themeColor().muted}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoCorrect
            />
            {liveErrors.first_name ? <Text style={styles.errText}>{liveErrors.first_name}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Last name</Text>
            <TextInput
              style={[styles.input, liveErrors.last_name ? styles.inputErr : null]}
              placeholder="Last name"
              placeholderTextColor={themeColor().muted}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoCorrect
            />
            {liveErrors.last_name ? <Text style={styles.errText}>{liveErrors.last_name}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            {showReferral ? (
              <>
                <Text style={styles.label}>Have a referral code? (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter code"
                  placeholderTextColor={themeColor().muted}
                  value={referralCode}
                  onChangeText={setReferralCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </>
            ) : (
              <Pressable onPress={() => setShowReferral(true)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.referralLink}>Have a code?</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{signedEmail}</Text>
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Gender (optional)</Text>
            <Pressable
              onPress={() => setGenderPickerOpen(true)}
              style={[styles.input, styles.selectTrigger]}
            >
              <Text style={gender ? styles.selectValue : styles.selectPlaceholder}>
                {gender ? labelFor(GENDER_OPTIONS, gender) : "Choose…"}
              </Text>
              <Text style={styles.selectChevron}>▾</Text>
            </Pressable>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Playing position</Text>
            <Pressable
              onPress={() => setPositionPickerOpen(true)}
              style={[styles.input, styles.selectTrigger, liveErrors.playing_position ? styles.inputErr : null]}
            >
              <Text style={playingPosition ? styles.selectValue : styles.selectPlaceholder}>
                {playingPosition ? labelFor(POSITION_OPTIONS, playingPosition) : "Choose…"}
              </Text>
              <Text style={styles.selectChevron}>▾</Text>
            </Pressable>
            {liveErrors.playing_position ? <Text style={styles.errText}>{liveErrors.playing_position}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>What&apos;s the highest level you&apos;ve played?</Text>
            <Text style={styles.fieldHint}>This sets your starting stars. You can get verified later.</Text>
            <StarLevelSelect
              value={statedLevel}
              onChange={setStatedLevel}
              invalid={!!liveErrors.stated_level}
              style={styles.levelSelect}
            />
            {liveErrors.stated_level ? <Text style={styles.errText}>{liveErrors.stated_level}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Instagram</Text>
            <TextInput
              style={styles.input}
              placeholder="@handle"
              placeholderTextColor={themeColor().muted}
              value={instagram}
              onChangeText={setInstagram}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Phone number (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor={themeColor().muted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCorrect={false}
            />
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Zip code</Text>
            <TextInput
              style={[styles.input, liveErrors.zip_code ? styles.inputErr : null]}
              placeholder="5-digit zip"
              placeholderTextColor={themeColor().muted}
              value={zipCode}
              onChangeText={(t) => setZipCode(t.replace(/\D/g, "").slice(0, 5))}
              keyboardType="numeric"
              maxLength={5}
              autoCorrect={false}
            />
            {liveErrors.zip_code ? <Text style={styles.errText}>{liveErrors.zip_code}</Text> : null}
            {zipOk && zipVenuePreviewChecking ? (
              <Text style={styles.zipVenueChecking}>Checking nearby venues…</Text>
            ) : null}
            {zipOk &&
            !zipVenuePreviewChecking &&
            !liveErrors.zip_code &&
            zipVenuePreviewEmpty === true ? (
              <Text style={styles.zipVenueInlineHint}>{COMPLETE_PROFILE_ZIP_NO_VENUE_MSG}</Text>
            ) : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Username</Text>
            <Text style={styles.fieldHint}>Your username — you can change this</Text>
            <TextInput
              style={[styles.input, liveErrors.username ? styles.inputErr : null]}
              placeholder="letters and numbers"
              placeholderTextColor={themeColor().muted}
              value={username}
              onChangeText={(t) => {
                usernameUserEdited.current = true;
                setUsername(t);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={PROFILE_USERNAME_MAX_LEN}
            />
            {username.trim() ? (
              <Text style={styles.atPreview}>You&apos;ll show as @{username.trim().toLowerCase()}</Text>
            ) : null}
            {liveErrors.username ? <Text style={styles.errText}>{liveErrors.username}</Text> : null}
          </View>

          <SelectModal<GenderValue>
            visible={genderPickerOpen}
            title="Gender"
            options={GENDER_OPTIONS}
            value={gender}
            onSelect={setGender}
            onClose={() => setGenderPickerOpen(false)}
          />
          <SelectModal<PositionValue>
            visible={positionPickerOpen}
            title="Playing position"
            options={POSITION_OPTIONS}
            value={playingPosition}
            onSelect={setPlayingPosition}
            onClose={() => setPositionPickerOpen(false)}
          />

          <Pressable
            onPress={() => {
              setAgeConfirmed((v) => !v);
              if (ageError) setAgeError(null);
            }}
            style={styles.checkboxRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ageConfirmed }}
          >
            <View style={[styles.checkbox, ageConfirmed && styles.checkboxChecked]}>
              {ageConfirmed ? <FontAwesome name="check" size={12} color={themeColor().onPitch} /> : null}
            </View>
            <Text style={styles.checkboxText}>I confirm I am 13 years of age or older</Text>
          </Pressable>
          {ageError ? <Text style={styles.errText}>{ageError}</Text> : null}

          {submitError ? <Text style={styles.submitErr}>{submitError}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, btnLocked && styles.primaryBtnDisabled]}
            onPress={() => void onContinue()}
            disabled={btnLocked}
          >
            {busy ? (
              <ActivityIndicator color={themeColor().onPitch} />
            ) : (
              <Text style={[styles.primaryBtnText, btnLocked && styles.primaryBtnTextDisabled]}>Continue</Text>
            )}
          </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: themeColor().bg },
  center: { flex: 1, backgroundColor: themeColor().bg, justifyContent: "center", alignItems: "center" },
  bgGlowA: {
    position: "absolute",
    top: -200,
    left: -140,
    width: 380,
    height: 380,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
  },
  bgGlowB: {
    position: "absolute",
    bottom: -240,
    right: -200,
    width: 480,
    height: 480,
    borderRadius: 999,
    backgroundColor: themeColor().pitchPanel,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 32, ...headline,
    color: themeColor().text,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 22,
    color: themeColor().muted,
  },
  fieldBlock: {
    marginTop: 16,
  },
  photoStep: { marginTop: 28 },
  photoStepHint: {
    marginTop: 16,
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: themeColor().muted,
    textAlign: "center",
  },
  photoSkip: { marginTop: 16, alignSelf: "center", paddingVertical: 8 },
  referralLink: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().accent },
  referralNote: { marginTop: 12, fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().coralText, textAlign: "center" },
  igStep: { marginTop: 20, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: themeColor().line, backgroundColor: themeColor().card, gap: 6 },
  igTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: themeColor().text },
  igBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: themeColor().muted },
  igActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 16, marginTop: 6 },
  igSkip: { paddingVertical: 8 },
  igGo: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: themeColor().pitch },
  igGoText: { fontSize: 14, fontFamily: "Inter_700Bold", color: themeColor().onPitch },
  photoSkipText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: themeColor().muted },
  label: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().muted,
  },
  fieldHint: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 18,
    color: themeColor().muted,
  },
  atPreview: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: themeColor().pitchText,
    fontWeight: "600",
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().text,
    backgroundColor: themeColor().overlaySubtle,
  },
  readonlyBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: themeColor().line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: themeColor().bg,
  },
  readonlyText: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().muted,
  },
  levelSelect: { marginTop: 8 },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectPlaceholder: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().muted,
  },
  selectValue: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().text,
  },
  selectChevron: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: themeColor().pitchText,
    marginLeft: 8,
  },
  inputErr: {
    borderColor: themeColor().coral,
  },
  errText: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: themeColor().coralText,
  },
  zipVenueInlineHint: {
    marginTop: 8,
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 19,
    color: themeColor().muted,
  },
  zipVenueChecking: {
    marginTop: 4,
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: themeColor().muted,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: themeColor().line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxChecked: {
    backgroundColor: themeColor().pitch,
    borderColor: themeColor().pitch,
  },
  checkboxText: {
    flex: 1,
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: themeColor().text,
    lineHeight: 20,
  },
  submitErr: {
    marginTop: 16,
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: themeColor().coralText,
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: themeColor().pitch,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: {
    backgroundColor: themeColor().overlay,
  },
  primaryBtnText: {
    color: themeColor().onPitch,
    fontWeight: "800",
    fontSize: 16, fontFamily: "Inter_700Bold",
  },
  primaryBtnTextDisabled: {
    color: themeColor().muted,
  },
  nearestCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().line,
    backgroundColor: themeColor().card,
  },
  nearestCardTitle: {
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
    marginBottom: 12,
  },
  nearestSectionHeader: {
    fontSize: 13, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
    marginBottom: 4,
  },
  nearestSectionHeaderFirst: {
    marginTop: 0,
  },
  nearestSectionHeaderAfter: {
    marginTop: 12,
  },
  nearestRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColor().line,
  },
  nearestRowLast: {
    borderBottomWidth: 0,
  },
  nearestRowLeft: {
    flex: 1,
    gap: 4,
  },
  nearestVenueName: {
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().text,
    lineHeight: 21,
  },
  nearestVenueAddress: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 18,
    color: themeColor().muted,
  },
  nearestEta: {
    fontSize: 14, fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: themeColor().pitchText,
  },
  nearestEmpty: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    lineHeight: 20,
    color: themeColor().muted,
  },
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: themeColor().scrim,
  },
  modalCardWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: themeColor().card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: themeColor().pitch,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  modalTitle: {
    fontSize: 16, fontFamily: "Inter_700Bold",
    fontWeight: "800",
    color: themeColor().pitchText,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginHorizontal: 4,
  },
  modalRowSelected: {
    backgroundColor: themeColor().pitchPanel,
  },
  modalRowText: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    color: themeColor().text,
  },
  modalRowTextSelected: {
    color: themeColor().pitchText,
    fontWeight: "700",
  },
  modalCancel: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCancelText: {
    fontSize: 16, fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: themeColor().muted,
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

