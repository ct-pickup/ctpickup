import { useAuth } from "@/context/AuthContext";
import { siteOrigin } from "@/lib/env";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const LIME = "#a3e635";
const BG = "#0a0a0a";

type Tournament = {
  id: string;
  title: string | null;
  status: string | null;
  prize: string | null;
  game: string | null;
};

type Registration = {
  id: string;
  payment_status: string | null;
  signed_full_name: string | null;
};

type PlayerProfile = {
  id: string;
  legal_name: string | null;
  contact_email: string | null;
  state: string | null;
  platform: "playstation" | "xbox" | null;
  psn_id: string | null;
  xbox_gamertag: string | null;
  ea_account: string | null;
  affirmed_18_plus: boolean | null;
};

type PlatformChoice = "ps5" | "xbox" | "pc";

const ESPORTS_CONFIRMATION_KEYS = [
  "age_18_plus",
  "us_legal_resident",
  "not_connecticut_resident",
  "agree_official_tournament_rules",
  "agree_terms_and_conditions",
  "agree_privacy_publicity_policy",
  "agree_tournament_operational_sms",
  "entry_fee_10_nonrefundable",
  "publicity_streaming_consent",
  "platform_account_requirements",
] as const;

function buildAllAgreedConfirmations(): Record<string, boolean> {
  return ESPORTS_CONFIRMATION_KEYS.reduce<Record<string, boolean>>((acc, k) => {
    acc[k] = true;
    return acc;
  }, {});
}

export default function EsportsRegisterScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { supabase, session, isReady } = useAuth();
  const navigation = useNavigation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);

  // Step 1 — consent
  const [agreed, setAgreed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentMsg, setConsentMsg] = useState<string | null>(null);

  // Step 2 — player profile
  const [pfPlatform, setPfPlatform] = useState<PlatformChoice>("ps5");
  const [pfConsole, setPfConsole] = useState("");
  const [pfOnlineId, setPfOnlineId] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Step 3 — payment
  const [payBusy, setPayBusy] = useState(false);

  useLayoutEffect(() => {
    const title = tournament?.title ?? "Register";
    navigation.setOptions?.({
      headerShown: true,
      title: "Register",
      headerTitleAlign: "center",
      headerStyle: { backgroundColor: BG },
      headerTintColor: "#fff",
      headerLeft: () => (
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else if (id) {
              router.replace(`/esports/${id}`);
            } else {
              router.replace("/(tabs)/esports");
            }
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 4,
            paddingVertical: 8,
            gap: 6,
          }}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${title}`}
        >
          <FontAwesome name="chevron-left" size={18} color={LIME} />
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "500" }}>Back</Text>
        </Pressable>
      ),
    });
  }, [navigation, router, tournament?.title, id]);

  const loadAll = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    setErr(null);

    const { data: t, error: tErr } = await supabase
      .from("esports_tournaments")
      .select("id,title,status,prize,game")
      .eq("id", id)
      .maybeSingle();

    if (tErr) {
      setErr(tErr.message);
      setLoading(false);
      return;
    }
    if (!t) {
      setErr("This tournament isn’t available.");
      setLoading(false);
      return;
    }
    setTournament(t as Tournament);

    const userId = session?.user?.id;
    if (userId) {
      const [{ data: regRow }, { data: profRow }] = await Promise.all([
        supabase
          .from("esports_tournament_registrations")
          .select("id,payment_status,signed_full_name")
          .eq("tournament_id", id)
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("esports_player_profiles")
          .select(
            "id,legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,affirmed_18_plus",
          )
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      if (regRow) {
        setRegistration(regRow as Registration);
        if ((regRow as Registration).signed_full_name && !fullName) {
          setFullName((regRow as Registration).signed_full_name ?? "");
        }
      }
      if (profRow) {
        const p = profRow as PlayerProfile;
        setProfile(p);
        if (p.platform === "playstation") {
          setPfPlatform("ps5");
          setPfOnlineId(p.psn_id ?? "");
        } else if (p.platform === "xbox") {
          setPfPlatform("xbox");
          setPfOnlineId(p.xbox_gamertag ?? "");
        }
        if (p.legal_name && !fullName) setFullName(p.legal_name);
      }
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, id, session?.user?.id]);

  useEffect(() => {
    if (!isReady) return;
    if (!supabase) {
      setErr("Sign in or configure Supabase in mobile/.env.");
      setLoading(false);
      return;
    }
    if (!session?.user?.id) {
      setErr("Sign in to register for esports tournaments.");
      setLoading(false);
      return;
    }
    if (!id) {
      setErr("Missing tournament id.");
      setLoading(false);
      return;
    }
    void loadAll();
  }, [isReady, supabase, session?.user?.id, id, loadAll]);

  async function submitConsent() {
    if (consentBusy) return;
    const name = fullName.trim();
    if (!agreed) {
      setConsentMsg("Check the agreement box to continue.");
      return;
    }
    if (name.length < 3) {
      setConsentMsg("Enter your full legal name.");
      return;
    }
    const token = session?.access_token;
    const base = siteOrigin();
    if (!token || !base) {
      setConsentMsg("Sign in and set EXPO_PUBLIC_SITE_URL in mobile/.env.");
      return;
    }

    setConsentBusy(true);
    setConsentMsg(null);
    try {
      const res = await fetch(`${base}/api/esports/tournament-registration/consent`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tournament_id: id,
          full_name: name,
          agreed: true,
          // The backend expects these fuller fields; keep the simple top-level
          // shape for any callers expecting it but also send the canonical names.
          signed_full_name: name,
          confirmations: buildAllAgreedConfirmations(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        registration_id?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        const msg = typeof data.error === "string" ? data.error : `Could not save consent (${res.status}).`;
        setConsentMsg(msg);
        return;
      }
      await loadAll();
      setConsentMsg(null);
    } catch (e) {
      setConsentMsg(e instanceof Error ? e.message : "Network error.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function saveProfile() {
    if (profileBusy) return;
    const onlineId = pfOnlineId.trim();
    if (pfPlatform === "pc") {
      setProfileMsg("PC isn’t supported yet — pick PS5 or Xbox.");
      return;
    }
    if (!onlineId) {
      setProfileMsg(pfPlatform === "ps5" ? "Enter your PSN ID." : "Enter your Xbox gamertag.");
      return;
    }
    if (!supabase || !session?.user) {
      setProfileMsg("You must be signed in.");
      return;
    }

    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const dbPlatform = pfPlatform === "ps5" ? "playstation" : "xbox";
      const consoleNote = pfConsole.trim();
      const eaNote = profile?.ea_account ?? null;
      const row = {
        user_id: session.user.id,
        legal_name: (profile?.legal_name ?? fullName.trim()) || "Player",
        contact_email: profile?.contact_email ?? session.user.email ?? "",
        state: profile?.state ?? "NY",
        platform: dbPlatform,
        psn_id: dbPlatform === "playstation" ? onlineId : null,
        xbox_gamertag: dbPlatform === "xbox" ? onlineId : null,
        ea_account: consoleNote || eaNote,
        affirmed_18_plus: profile?.affirmed_18_plus ?? true,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("esports_player_profiles")
        .upsert(row, { onConflict: "user_id" })
        .select(
          "id,legal_name,contact_email,state,platform,psn_id,xbox_gamertag,ea_account,affirmed_18_plus",
        )
        .single();

      if (error) {
        setProfileMsg(error.message);
        return;
      }
      setProfile(data as PlayerProfile);
      setProfileMsg(null);
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : "Could not save profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function payEntryFee() {
    if (payBusy) return;
    const token = session?.access_token;
    const base = siteOrigin();
    if (!token || !base) {
      Alert.alert("Can’t pay", "Sign in and set EXPO_PUBLIC_SITE_URL in mobile/.env.");
      return;
    }
    setPayBusy(true);
    try {
      const res = await fetch(`${base}/api/esports/tournament-registration/checkout`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tournament_id: id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        checkout_url?: string;
        error?: string;
      };
      if (res.ok && data.ok && typeof data.checkout_url === "string" && data.checkout_url) {
        await WebBrowser.openBrowserAsync(data.checkout_url);
        await loadAll();
        return;
      }
      const msg = typeof data.error === "string" ? data.error : `Could not start checkout (${res.status}).`;
      Alert.alert("Can’t pay", msg);
    } catch (e) {
      Alert.alert("Can’t pay", e instanceof Error ? e.message : "Network error.");
    } finally {
      setPayBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (err || !tournament) {
    return (
      <View style={styles.pad}>
        <Text style={styles.err}>{err ?? "Not found"}</Text>
      </View>
    );
  }

  const alreadyPaid = registration?.payment_status === "paid";
  const consentDone = !!registration;
  const hasPlatformId =
    profile?.platform === "playstation"
      ? !!profile.psn_id
      : profile?.platform === "xbox"
        ? !!profile.xbox_gamertag
        : false;
  const profileDone = !!profile && hasPlatformId;
  const canPay = consentDone && profileDone && !alreadyPaid;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>ESPORTS · ENTRY</Text>
        <Text style={styles.title}>{tournament.title ?? "Esports tournament"}</Text>
        <Text style={styles.subTitle}>
          <FontAwesome name="trophy" size={13} color={LIME} /> {tournament.prize ?? "Prize TBA"}
        </Text>

        {alreadyPaid ? (
          <View style={styles.paidBanner}>
            <FontAwesome name="check-circle" size={18} color={LIME} />
            <Text style={styles.paidBannerText}>Registered — entry fee received</Text>
          </View>
        ) : null}

        {/* Step 1 — Legal consent */}
        <Section
          step={1}
          title="Legal consent"
          done={consentDone}
          locked={alreadyPaid}
        >
          <ScrollView
            style={styles.terms}
            contentContainerStyle={styles.termsContent}
            nestedScrollEnabled
          >
            <Text style={styles.termsHeader}>CT Pickup Esports Entry Agreement</Text>
            <Text style={styles.termsP}>
              Entry fee is <Text style={styles.bold}>$10 USD</Text> and is{" "}
              <Text style={styles.bold}>non-refundable</Text> once submitted, except where required
              by law or under the published Official Tournament Rules (refunds must be requested
              more than 48 hours before tournament start).
            </Text>
            <Text style={styles.termsP}>
              You must complete every match before its scheduled deadline. Missed deadlines result in
              forfeit, and forfeits do not entitle you to a refund.
            </Text>
            <Text style={styles.termsP}>
              You consent to CT Pickup, its operators, and authorized partners capturing and using
              your name, gamertag, likeness, gameplay footage, voice, and stream/recording in any
              media now known or later developed for promotion, broadcast, and tournament operations,
              without further compensation, except where prohibited by law.
            </Text>
            <Text style={styles.termsP}>
              Your platform account (PSN ID or Xbox gamertag) must be valid, active, and yours. You
              must keep that gamertag throughout the tournament and use it for every match.
              Misrepresentation of identity, account sharing, smurfing, or cheating results in
              disqualification with no refund.
            </Text>
            <Text style={styles.termsP}>
              Tournament logistics (opponents, group stage, schedule changes, check-in, reporting)
              may be sent by SMS to the phone number on your CT Pickup account. Standard message and
              data rates may apply.
            </Text>
            <Text style={styles.termsP}>
              You confirm you are 18 years or older, a US legal resident, and that you are not a
              Connecticut resident. CT residents are not eligible to compete.
            </Text>
            <Text style={styles.termsP}>
              By checking the box and typing your full legal name below, you adopt your typed name as
              your electronic signature with the same legal effect as a handwritten signature, and
              you agree to the Official Tournament Rules, Terms and Conditions, and Privacy and
              Publicity Consent Policy.
            </Text>
          </ScrollView>

          <Pressable
            style={styles.checkRow}
            onPress={() => !alreadyPaid && setAgreed((v) => !v)}
            disabled={alreadyPaid}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I agree to all terms above"
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed ? <FontAwesome name="check" size={12} color="#0a0a0a" /> : null}
            </View>
            <Text style={styles.checkLabel}>
              I agree to the Entry Agreement, Tournament Rules, Terms, and Privacy/Publicity Policy.
            </Text>
          </Pressable>

          <Text style={styles.fieldLabel}>Full legal name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="First and last name"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoComplete="name"
            editable={!alreadyPaid}
            returnKeyType="done"
          />

          {consentMsg ? <Text style={styles.errInline}>{consentMsg}</Text> : null}

          {!consentDone ? (
            <Pressable
              style={[styles.primaryBtn, (!agreed || consentBusy) && styles.btnDisabled]}
              onPress={() => void submitConsent()}
              disabled={!agreed || consentBusy || alreadyPaid}
              accessibilityRole="button"
              accessibilityLabel="Submit consent"
            >
              {consentBusy ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.primaryBtnText}>Submit consent</Text>
              )}
            </Pressable>
          ) : (
            <View style={styles.doneRow}>
              <FontAwesome name="check-circle" size={14} color={LIME} />
              <Text style={styles.doneText}>Consent recorded</Text>
            </View>
          )}
        </Section>

        {/* Step 2 — Player profile */}
        <Section
          step={2}
          title="Player profile"
          done={profileDone}
          locked={alreadyPaid}
        >
          <Text style={styles.fieldLabel}>Platform</Text>
          <View style={styles.platformRow}>
            <PlatformPill
              label="PS5"
              active={pfPlatform === "ps5"}
              onPress={() => setPfPlatform("ps5")}
              disabled={alreadyPaid}
            />
            <PlatformPill
              label="Xbox"
              active={pfPlatform === "xbox"}
              onPress={() => setPfPlatform("xbox")}
              disabled={alreadyPaid}
            />
            <PlatformPill
              label="PC"
              active={pfPlatform === "pc"}
              onPress={() => setPfPlatform("pc")}
              disabled={alreadyPaid}
            />
          </View>

          <Text style={styles.fieldLabel}>Console / device</Text>
          <TextInput
            style={styles.input}
            value={pfConsole}
            onChangeText={setPfConsole}
            placeholder={
              pfPlatform === "ps5"
                ? "PlayStation 5 (Slim, Pro)"
                : pfPlatform === "xbox"
                  ? "Xbox Series X|S"
                  : "PC build"
            }
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!alreadyPaid}
          />

          <Text style={styles.fieldLabel}>
            {pfPlatform === "ps5"
              ? "PSN ID"
              : pfPlatform === "xbox"
                ? "Xbox gamertag"
                : "Online ID"}
          </Text>
          <TextInput
            style={styles.input}
            value={pfOnlineId}
            onChangeText={setPfOnlineId}
            placeholder={
              pfPlatform === "ps5"
                ? "Your PSN ID"
                : pfPlatform === "xbox"
                  ? "Your Xbox gamertag"
                  : "Your online ID"
            }
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!alreadyPaid}
          />

          {profileMsg ? <Text style={styles.errInline}>{profileMsg}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, profileBusy && styles.btnDisabled]}
            onPress={() => void saveProfile()}
            disabled={profileBusy || alreadyPaid}
            accessibilityRole="button"
            accessibilityLabel="Save player profile"
          >
            {profileBusy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>{profile ? "Update profile" : "Save profile"}</Text>
            )}
          </Pressable>

          {profileDone ? (
            <View style={styles.doneRow}>
              <FontAwesome name="check-circle" size={14} color={LIME} />
              <Text style={styles.doneText}>Profile complete</Text>
            </View>
          ) : null}
        </Section>

        {/* Step 3 — Payment */}
        <Section
          step={3}
          title="Payment"
          done={alreadyPaid}
          locked={false}
        >
          {alreadyPaid ? (
            <View style={styles.doneRow}>
              <FontAwesome name="check-circle" size={14} color={LIME} />
              <Text style={styles.doneText}>Entry fee received</Text>
            </View>
          ) : (
            <>
              <Text style={styles.payHint}>
                Single entry fee of $10 USD. Opens a secure Stripe checkout in your browser.
              </Text>
              <Pressable
                style={[styles.payBtn, (!canPay || payBusy) && styles.btnDisabled]}
                onPress={() => void payEntryFee()}
                disabled={!canPay || payBusy}
                accessibilityRole="button"
                accessibilityLabel="Pay entry fee ten dollars"
              >
                {payBusy ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <>
                    <FontAwesome name="credit-card" size={16} color="#0a0a0a" />
                    <Text style={styles.payBtnText}> Pay entry fee $10</Text>
                  </>
                )}
              </Pressable>
              {!canPay ? (
                <Text style={styles.payLockHint}>
                  {!consentDone
                    ? "Submit consent first."
                    : !profileDone
                      ? "Save your player profile first."
                      : ""}
                </Text>
              ) : null}
            </>
          )}
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({
  step,
  title,
  done,
  locked,
  children,
}: {
  step: number;
  title: string;
  done: boolean;
  locked: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, locked && styles.sectionLocked]}>
      <View style={styles.sectionHead}>
        <View style={[styles.stepBadge, done && styles.stepBadgeDone]}>
          {done ? (
            <FontAwesome name="check" size={12} color="#0a0a0a" />
          ) : (
            <Text style={styles.stepBadgeText}>{step}</Text>
          )}
        </View>
        <Text style={styles.sectionTitle}>
          Step {step} — {title}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function PlatformPill({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.platformPill, active && styles.platformPillActive, disabled && styles.btnDisabled]}
    >
      <Text style={[styles.platformPillText, active && styles.platformPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  content: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", padding: 24 },
  pad: { flex: 1, backgroundColor: BG, padding: 20 },

  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "rgba(163,230,53,0.7)",
  },
  title: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
  },
  subTitle: {
    marginTop: 6,
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
  },

  paidBanner: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(163,230,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(163,230,53,0.45)",
  },
  paidBannerText: { color: LIME, fontWeight: "800", fontSize: 14 },

  section: {
    marginTop: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  sectionLocked: { opacity: 0.85 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  stepBadgeDone: {
    backgroundColor: LIME,
    borderColor: LIME,
  },
  stepBadgeText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  sectionTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sectionBody: { paddingHorizontal: 14, paddingBottom: 16, paddingTop: 4 },

  terms: {
    maxHeight: 200,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.35)",
    marginTop: 4,
  },
  termsContent: { padding: 12 },
  termsHeader: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
    marginBottom: 8,
  },
  termsP: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  bold: { color: "#fff", fontWeight: "700" },

  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 14,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  checkboxChecked: { backgroundColor: LIME, borderColor: LIME },
  checkLabel: {
    flex: 1,
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    lineHeight: 19,
  },

  fieldLabel: {
    marginTop: 14,
    marginBottom: 6,
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#fff",
    fontSize: 15,
  },

  platformRow: { flexDirection: "row", gap: 8 },
  platformPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  platformPillActive: {
    backgroundColor: "rgba(163,230,53,0.15)",
    borderColor: "rgba(163,230,53,0.55)",
  },
  platformPillText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 14 },
  platformPillTextActive: { color: LIME },

  primaryBtn: {
    marginTop: 16,
    width: "100%",
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 14 },
  btnDisabled: { opacity: 0.45 },

  payHint: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 4,
  },
  payBtn: {
    flexDirection: "row",
    marginTop: 12,
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: LIME,
    alignItems: "center",
    justifyContent: "center",
  },
  payBtnText: { color: "#0a0a0a", fontWeight: "800", fontSize: 15 },
  payLockHint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    textAlign: "center",
  },

  doneRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  doneText: { color: LIME, fontWeight: "700", fontSize: 13 },

  errInline: {
    marginTop: 10,
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 18,
  },
  err: { color: "#fca5a5", fontSize: 15, lineHeight: 22 },
});
