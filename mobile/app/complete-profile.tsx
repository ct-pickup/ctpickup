import { useProfileCompletionGate } from "@/context/ProfileCompletionContext";
import { useAuth } from "@/context/AuthContext";
import { useWaiver } from "@/context/WaiverContext";
import { CT_PICKUP_LIME } from "@/constants/Colors";
import { siteOrigin } from "@/lib/env";
import {
  normalizeProfileUsername,
  PROFILE_USERNAME_MAX_LEN,
  USERNAME_TAKEN_USER_MESSAGE,
} from "@/lib/profileIdentityFields";
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

const BG = "#0a0a0a";
const LIME = CT_PICKUP_LIME;

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
      !cleanInstagram(instagram) ||
      !zipOk ||
      !username.trim()
    )
      return false;
    return true;
  }, [firstName, lastName, playingPosition, instagram, zipOk, username]);

  const liveErrors = useMemo((): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!firstName.trim()) e.first_name = "Required";
    if (!lastName.trim()) e.last_name = "Required";
    if (!playingPosition) e.playing_position = "Required";
    if (!cleanInstagram(instagram)) e.instagram = "Required";
    if (!zipDigits) e.zip_code = "Required";
    else if (!zipOk) e.zip_code = "Enter a 5-digit zip";
    if (!username.trim()) e.username = "Required";
    else if (!normalizeProfileUsername(username))
      e.username = "3–30 characters, lowercase letters and numbers only";
    return e;
  }, [firstName, lastName, playingPosition, instagram, zipDigits, zipOk, username]);

  const postSaveVenueSections = useMemo(
    () => (postSaveVenues && postSaveVenues.length > 0 ? nearestVenueSections(postSaveVenues) : []),
    [postSaveVenues],
  );

  const firstLiveErrorMessage = useMemo(() => {
    const ordered: FieldKey[] = [
      "first_name",
      "last_name",
      "playing_position",
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
      const m = "You must be 13 or older to use CT Pickup";
      setAgeError(m);
      setSubmitError(m);
      Alert.alert("Age requirement", m);
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
  ]);

  const onContinueToApp = useCallback(() => {
    markProfileComplete();
    router.replace("/(tabs)" as Href);
  }, [markProfileComplete, router]);

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!session?.user?.email) {
    return <Redirect href="/login" />;
  }

  if (waiverLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!waiverAccepted) {
    return <Redirect href="/waiver" />;
  }

  if (profileGateLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
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
          {postSaveVenues ? (
            <>
              <Text style={styles.title}>Profile saved</Text>
              <Text style={styles.subtitle}>You&apos;re ready to find pickup and events.</Text>

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
              placeholderTextColor="rgba(255,255,255,0.35)"
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
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoCorrect
            />
            {liveErrors.last_name ? <Text style={styles.errText}>{liveErrors.last_name}</Text> : null}
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
            <Text style={styles.label}>Instagram</Text>
            <TextInput
              style={[styles.input, liveErrors.instagram ? styles.inputErr : null]}
              placeholder="@handle"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={instagram}
              onChangeText={setInstagram}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {liveErrors.instagram ? <Text style={styles.errText}>{liveErrors.instagram}</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Phone number (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor="rgba(255,255,255,0.35)"
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
              placeholderTextColor="rgba(255,255,255,0.35)"
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
              placeholderTextColor="rgba(255,255,255,0.35)"
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
              {ageConfirmed ? <FontAwesome name="check" size={12} color="#0a0a0a" /> : null}
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
              <ActivityIndicator color="#111" />
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: BG },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center" },
  bgGlowA: {
    position: "absolute",
    top: -200,
    left: -140,
    width: 380,
    height: 380,
    borderRadius: 380,
    backgroundColor: "rgba(163,230,53,0.10)",
  },
  bgGlowB: {
    position: "absolute",
    bottom: -240,
    right: -200,
    width: 480,
    height: 480,
    borderRadius: 480,
    backgroundColor: "rgba(163,230,53,0.06)",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.62)",
  },
  fieldBlock: {
    marginTop: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
  },
  fieldHint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: "rgba(255,255,255,0.48)",
  },
  atPreview: {
    marginTop: 6,
    fontSize: 13,
    color: "rgba(163,230,53,0.85)",
    fontWeight: "600",
  },
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
  readonlyBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  readonlyText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.45)",
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
  inputErr: {
    borderColor: "rgba(252,165,165,0.65)",
  },
  errText: {
    marginTop: 6,
    fontSize: 13,
    color: "#fca5a5",
  },
  zipVenueInlineHint: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(255,255,255,0.5)",
  },
  zipVenueChecking: {
    marginTop: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 22,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxChecked: {
    backgroundColor: LIME,
    borderColor: LIME,
  },
  checkboxText: {
    flex: 1,
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
    lineHeight: 20,
  },
  submitErr: {
    marginTop: 16,
    fontSize: 14,
    color: "#fca5a5",
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: LIME,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  primaryBtnText: {
    color: "#111",
    fontWeight: "800",
    fontSize: 16,
  },
  primaryBtnTextDisabled: {
    color: "rgba(255,255,255,0.35)",
  },
  nearestCard: {
    marginTop: 22,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  nearestCardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: LIME,
    letterSpacing: 0.3,
    marginBottom: 14,
  },
  nearestSectionHeader: {
    fontSize: 13,
    fontWeight: "800",
    color: LIME,
    letterSpacing: 0.45,
    marginBottom: 6,
  },
  nearestSectionHeaderFirst: {
    marginTop: 0,
  },
  nearestSectionHeaderAfter: {
    marginTop: 14,
  },
  nearestRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  nearestRowLast: {
    borderBottomWidth: 0,
  },
  nearestRowLeft: {
    flex: 1,
    gap: 4,
  },
  nearestVenueName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
    lineHeight: 21,
  },
  nearestVenueAddress: {
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(255,255,255,0.6)",
  },
  nearestEta: {
    fontSize: 14,
    fontWeight: "700",
    color: LIME,
  },
  nearestEmpty: {
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.55)",
  },
  modalRoot: {
    flex: 1,
  },
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
  modalRowSelected: {
    backgroundColor: "rgba(163,230,53,0.12)",
  },
  modalRowText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.85)",
  },
  modalRowTextSelected: {
    color: LIME,
    fontWeight: "700",
  },
  modalCancel: {
    marginTop: 4,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
  },
});
