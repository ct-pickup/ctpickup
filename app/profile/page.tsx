"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AuthenticatedProfileMenu,
  PageShell,
  Panel,
  TopNav,
} from "@/components/layout";
import { APP_HOME_URL } from "@/lib/siteNav";
import { useSupabaseBrowser } from "@/lib/supabase/useSupabaseBrowser";
import { EsportsGoaliePreferenceFields } from "@/components/profile/EsportsGoaliePreferenceFields";
import {
  EMPTY_PROFILE_ROW,
  profileDisplayName,
  type ProfileRow,
} from "@/lib/profileFields";
import { broadcastProfileUpdated } from "@/lib/profileBroadcast";
import {
  PROFILE_GENDER_LABELS,
  type ProfileGender,
  parseProfileGender,
  profileIdentityColumns,
  normalizePlayingPosition,
} from "@/lib/profileIdentityFields";
import {
  isMissingProfileColumnError,
  loadProfileRowForUser,
  profileSchemaMismatchUserMessage,
} from "@/lib/profileLoad";
import {
  bindEsportsPreferenceHandlers,
  esportsDetailsComplete,
  esportsProfileNudgeCopy,
  formatEsportsSummary,
  formatGoaliePreference,
  parseEsportsConsole,
  parseEsportsInterest,
  parseEsportsPlatform,
  profileEsportsGoalieColumns,
  sanitizeEsportsFormState,
  type EsportsConsole,
  type EsportsInterest,
  type EsportsPlatform,
} from "@/lib/profilePreferences";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";

const AVATAR_STORAGE_PATH = "avatar.jpg";
const MAX_BYTES = 2 * 1024 * 1024;

function UserGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      className={className ?? "text-white/45"}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M20 21a8 8 0 0 0-16 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function fieldRow(label: string, value: string | null | undefined) {
  const v = value != null && String(value).trim() ? String(value).trim() : null;
  if (!v) return null;
  return (
    <div className="border-b border-white/10 py-4 last:border-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white/90 break-words">{v}</dd>
    </div>
  );
}

function cleanIG(s: string) {
  return s.trim().replace(/^@/, "").replace(/\s+/g, "");
}

export default function ProfilePage() {
  const router = useRouter();
  const { supabase, isReady } = useSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const [esportsInterest, setEsportsInterest] = useState<EsportsInterest | null>(null);
  const [esportsPlatform, setEsportsPlatform] = useState<EsportsPlatform | null>(null);
  const [esportsConsole, setEsportsConsole] = useState<EsportsConsole | null>(null);
  const [esportsOnlineId, setEsportsOnlineId] = useState("");
  const [playsGoalie, setPlaysGoalie] = useState<boolean | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);
  const [hasEsportsSchema, setHasEsportsSchema] = useState(true);

  const [basicsFirstName, setBasicsFirstName] = useState("");
  const [basicsLastName, setBasicsLastName] = useState("");
  const [basicsGender, setBasicsGender] = useState<ProfileGender | "">("");
  const [basicsGenderOther, setBasicsGenderOther] = useState("");
  const [basicsPlayingPosition, setBasicsPlayingPosition] = useState("");
  const [basicsPhone, setBasicsPhone] = useState("");
  const [basicsInstagram, setBasicsInstagram] = useState("");
  const [basicsBusy, setBasicsBusy] = useState(false);
  const [basicsMsg, setBasicsMsg] = useState<string | null>(null);

  const [contactBusy, setContactBusy] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);

  const { onEsportsInterest, onEsportsPlatform } = useMemo(
    () =>
      bindEsportsPreferenceHandlers({
        setInterest: setEsportsInterest,
        setPlatform: setEsportsPlatform,
        setConsole: setEsportsConsole,
        setOnlineId: setEsportsOnlineId,
      }),
    [],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    setMsg(null);
    const { data, error } = await supabase.auth.getUser();
    const user = data.user;
    if (error || !user) {
      setUserId(null);
      setEmail(null);
      setProfile(null);
      setLoading(false);
      router.replace("/login");
      return;
    }

    setUserId(user.id);
    setEmail(user.email ?? null);

    const res = await loadProfileRowForUser(supabase, user.id);
    setHasEsportsSchema(res.hasEsportsSchema);
    if (res.error) {
      setMsg(
        isMissingProfileColumnError(res.error)
          ? profileSchemaMismatchUserMessage()
          : res.error,
      );
      setProfile(null);
    } else {
      setProfile(res.row);
      setAvatarBroken(false);
    }
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    if (!profile) return;
    const sanitized = sanitizeEsportsFormState({
      interest: parseEsportsInterest(profile.esports_interest),
      platform: parseEsportsPlatform(profile.esports_platform),
      console: parseEsportsConsole(profile.esports_console),
      onlineId: profile.esports_online_id ?? "",
    });
    setEsportsInterest(sanitized.interest);
    setEsportsPlatform(sanitized.platform);
    setEsportsConsole(sanitized.console);
    setEsportsOnlineId(sanitized.onlineId);
    setPlaysGoalie(
      profile.plays_goalie === true || profile.plays_goalie === false ? profile.plays_goalie : null
    );
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    setBasicsFirstName(String(profile.first_name ?? ""));
    setBasicsLastName(String(profile.last_name ?? ""));
    setBasicsGender(parseProfileGender(profile.gender) ?? "");
    setBasicsGenderOther(String(profile.gender_other ?? ""));
    setBasicsPlayingPosition(String(profile.playing_position ?? ""));
    setBasicsPhone(String(profile.phone ?? ""));
    setBasicsInstagram(String(profile.instagram ?? ""));
  }, [profile]);

  useEffect(() => {
    if (!isReady) return;
    if (!supabase) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, isReady, supabase]);

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    if (!supabase) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    setMsg(null);
    if (!file.type.startsWith("image/")) {
      setMsg("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMsg("Image must be 2MB or smaller.");
      return;
    }

    setUploadBusy(true);
    const path = `${userId}/${AVATAR_STORAGE_PATH}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "image/jpeg",
      });
    if (upErr) {
      setUploadBusy(false);
      setMsg(upErr.message);
      return;
    }

    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = pub.publicUrl;
    const { error: dbErr } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", userId);

    setUploadBusy(false);
    if (dbErr) {
      setMsg(
        isMissingProfileColumnError(dbErr.message)
          ? profileSchemaMismatchUserMessage()
          : dbErr.message,
      );
      return;
    }

    setAvatarBroken(false);
    setProfile((p) =>
      p ? { ...p, avatar_url: publicUrl } : { ...EMPTY_PROFILE_ROW, avatar_url: publicUrl }
    );
    broadcastProfileUpdated();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function savePreferences() {
    if (!supabase || !userId) return;
    setPrefsMsg(null);
    if (!hasEsportsSchema) {
      setPrefsMsg(profileSchemaMismatchUserMessage());
      return;
    }
    if (esportsInterest === null || playsGoalie === null) {
      setPrefsMsg("Choose an answer for online tournaments and for playing goalie.");
      return;
    }
    if (
      !esportsDetailsComplete({
        esports_interest: esportsInterest,
        esports_platform: esportsPlatform,
        esports_console: esportsConsole,
        esports_online_id: esportsOnlineId,
      })
    ) {
      setPrefsMsg(
        "You’re interested in online tournaments — pick platform, console, and your gamertag or online ID.",
      );
      return;
    }

    const prefs = profileEsportsGoalieColumns({
      esportsInterest,
      esportsPlatform,
      esportsConsole,
      esportsOnlineId,
      playsGoalie,
    });

    setPrefsBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        esports_interest: prefs.esports_interest,
        esports_platform: prefs.esports_platform,
        esports_console: prefs.esports_console,
        esports_online_id: prefs.esports_online_id,
        plays_goalie: prefs.plays_goalie,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    setPrefsBusy(false);
    if (error) {
      setPrefsMsg(
        isMissingProfileColumnError(error.message)
          ? profileSchemaMismatchUserMessage()
          : error.message,
      );
      return;
    }

    setProfile((p) =>
      p
        ? {
            ...p,
            esports_interest: prefs.esports_interest,
            esports_platform: prefs.esports_platform,
            esports_console: prefs.esports_console,
            esports_online_id: prefs.esports_online_id,
            plays_goalie: prefs.plays_goalie,
          }
        : p
    );
    broadcastProfileUpdated();
    setPrefsMsg("Saved.");
  }

  async function saveContact() {
    if (!supabase || !userId) return;
    setContactMsg(null);

    const phoneClean = basicsPhone.trim();
    const igClean = cleanIG(basicsInstagram);
    if (!phoneClean) return setContactMsg("Phone is required.");
    if (!igClean) return setContactMsg("Instagram is required.");

    setContactBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        phone: phoneClean,
        instagram: igClean,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    setContactBusy(false);
    if (error) {
      setContactMsg(
        isMissingProfileColumnError(error.message)
          ? profileSchemaMismatchUserMessage()
          : error.message,
      );
      return;
    }

    setProfile((p) =>
      p
        ? {
            ...p,
            phone: phoneClean,
            instagram: igClean,
          }
        : p,
    );
    broadcastProfileUpdated();
    setContactMsg("Saved.");
  }

  async function saveBasics() {
    if (!supabase || !userId) return;
    setBasicsMsg(null);
    if (!basicsFirstName.trim()) return setBasicsMsg("First name is required.");
    if (!basicsLastName.trim()) return setBasicsMsg("Last name is required.");
    if (!basicsGender) return setBasicsMsg("Sex / gender is required.");
    if (!normalizePlayingPosition(basicsPlayingPosition)) {
      return setBasicsMsg("Playing position is required.");
    }

    const identity = profileIdentityColumns({
      firstName: basicsFirstName,
      lastName: basicsLastName,
      gender: basicsGender as ProfileGender,
      genderOther: basicsGenderOther,
      playingPosition: basicsPlayingPosition,
    });

    setBasicsBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: identity.first_name,
        last_name: identity.last_name,
        gender: identity.gender,
        gender_other: identity.gender_other,
        playing_position: identity.playing_position,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    setBasicsBusy(false);

    if (error) {
      setBasicsMsg(
        isMissingProfileColumnError(error.message)
          ? profileSchemaMismatchUserMessage()
          : error.message,
      );
      return;
    }

    setProfile((p) =>
      p
        ? {
            ...p,
            first_name: identity.first_name,
            last_name: identity.last_name,
            gender: identity.gender,
            gender_other: identity.gender_other,
            playing_position: identity.playing_position,
          }
        : p,
    );
    broadcastProfileUpdated();
    setBasicsMsg("Saved.");
  }

  const displayName =
    profileDisplayName(profile) || email?.split("@")[0] || "Your profile";

  const avatarSrc = profile?.avatar_url?.trim() || null;
  const showAvatarImg = Boolean(avatarSrc) && !avatarBroken;

  const ig =
    profile?.instagram != null && String(profile.instagram).trim()
      ? `@${String(profile.instagram).replace(/^@/, "")}`
      : null;

  if (!isReady || loading) {
    return (
      <PageShell maxWidthClass="max-w-2xl">
        <TopNav
          rightSlot={<AuthenticatedProfileMenu />}
        />
        <p className="py-12 text-center text-sm text-white/50">Loading profile…</p>
      </PageShell>
    );
  }

  if (!userId) {
    return null;
  }

  return (
    <PageShell maxWidthClass="max-w-2xl">
      <TopNav
        rightSlot={<AuthenticatedProfileMenu />}
      />
      <div className="pb-16 pt-4">
        <h1 className="text-2xl font-semibold uppercase tracking-tight text-white md:text-3xl">
          Profile
        </h1>
        <p className="mt-2 text-sm text-white/55">{displayName}</p>

        <Panel className="mt-8 space-y-6 p-6 md:p-8">
          <div className="flex flex-col items-center gap-4 border-b border-white/10 pb-8">
            <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/5">
              {showAvatarImg ? (
                <img
                  src={avatarSrc!}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <UserGlyph />
              )}
            </div>
            <label className="cursor-pointer rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/90 transition hover:bg-white/10">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadBusy}
                onChange={onPickFile}
              />
              {uploadBusy ? "Uploading…" : "Change profile photo"}
            </label>
          </div>

          <dl>
            {fieldRow("Email", email)}
            {fieldRow("First name", profile?.first_name)}
            {fieldRow("Last name", profile?.last_name)}
            {fieldRow(
              "Sex / gender",
              profile?.gender
                ? PROFILE_GENDER_LABELS[profile.gender as ProfileGender] ??
                    String(profile.gender)
                : null,
            )}
            {profile?.gender === "other"
              ? fieldRow("Gender description", profile?.gender_other)
              : null}
            {fieldRow("Playing position", profile?.playing_position)}
            {fieldRow("Goalie", formatGoaliePreference(profile?.plays_goalie))}
            {fieldRow("Online tournaments", formatEsportsSummary(profile ?? {}))}
            {fieldRow("Phone", profile?.phone)}
            {fieldRow("Instagram", ig)}
            <div className="border-b border-white/10 py-4 last:border-0">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Waiver
              </dt>
              <dd className="mt-1 text-sm text-white/90 break-words">
                <Link
                  href="/liability-waiver"
                  className="font-semibold text-white underline-offset-4 hover:underline"
                >
                  Liability Waiver &amp; Participation Agreement
                </Link>{" "}
                ({CURRENT_WAIVER_VERSION})
              </dd>
            </div>
          </dl>

          <div className="space-y-4 border-t border-white/10 pt-8">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/80">
                Basics
              </h2>
              <p className="mt-1 text-xs text-white/45 leading-relaxed">
                These are used for identity and roster basics. Update anytime.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                value={basicsFirstName}
                onChange={(e) => setBasicsFirstName(e.target.value)}
                disabled={basicsBusy}
                placeholder="First name"
                autoComplete="given-name"
              />
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                value={basicsLastName}
                onChange={(e) => setBasicsLastName(e.target.value)}
                disabled={basicsBusy}
                placeholder="Last name"
                autoComplete="family-name"
              />
            </div>

            <div className="w-full">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Sex / gender
              </label>
              <select
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white outline-none focus:border-white/25"
                value={basicsGender}
                onChange={(e) => setBasicsGender(e.target.value as any)}
                disabled={basicsBusy}
              >
                <option value="" disabled>
                  Select…
                </option>
                <option value="male">{PROFILE_GENDER_LABELS.male}</option>
                <option value="female">{PROFILE_GENDER_LABELS.female}</option>
                <option value="other">{PROFILE_GENDER_LABELS.other}</option>
              </select>
            </div>

            {basicsGender === "other" ? (
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                value={basicsGenderOther}
                onChange={(e) => setBasicsGenderOther(e.target.value)}
                disabled={basicsBusy}
                placeholder="Describe (optional)"
                maxLength={64}
              />
            ) : null}

            <input
              className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
              value={basicsPlayingPosition}
              onChange={(e) => setBasicsPlayingPosition(e.target.value)}
              disabled={basicsBusy}
              placeholder="Playing position"
            />

            {basicsMsg ? (
              <p className="text-sm text-amber-200/90 leading-relaxed whitespace-pre-line">
                {basicsMsg}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void saveBasics()}
              disabled={basicsBusy}
              className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50 sm:w-auto"
            >
              {basicsBusy ? "Saving…" : "Save basics"}
            </button>
          </div>

          <div className="space-y-4 border-t border-white/10 pt-8">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/80">
                Pickup &amp; online preferences
              </h2>
              <p className="mt-1 text-xs text-white/45 leading-relaxed">
                Update anytime. Prize tournaments need platform details only if you choose &quot;Yes, interested.&quot; You can
                always get back here from the profile icon.
              </p>
            </div>

            {!hasEsportsSchema ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/95 leading-relaxed whitespace-pre-line">
                {profileSchemaMismatchUserMessage()}
              </div>
            ) : (
              <EsportsGoaliePreferenceFields
                variant="signup"
                esportsInterest={esportsInterest}
                onEsportsInterest={onEsportsInterest}
                esportsPlatform={esportsPlatform}
                onEsportsPlatform={onEsportsPlatform}
                esportsConsole={esportsConsole}
                onEsportsConsole={setEsportsConsole}
                esportsOnlineId={esportsOnlineId}
                onEsportsOnlineIdChange={setEsportsOnlineId}
                playsGoalie={playsGoalie}
                onPlaysGoalie={setPlaysGoalie}
                disabled={prefsBusy}
                incompleteBanner={
                  profile && hasEsportsSchema ? esportsProfileNudgeCopy(profile) : null
                }
                hideIntro
              />
            )}

            {prefsMsg ? (
              <p className="text-sm text-amber-200/90 leading-relaxed whitespace-pre-line">{prefsMsg}</p>
            ) : null}

            <button
              type="button"
              onClick={() => void savePreferences()}
              disabled={prefsBusy || !hasEsportsSchema}
              className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50 sm:w-auto"
            >
              {prefsBusy ? "Saving…" : "Save preferences"}
            </button>
          </div>

          <div className="space-y-4 border-t border-white/10 pt-8">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/80">
                Contact
              </h2>
              <p className="mt-1 text-xs text-white/45 leading-relaxed">
                Used for contacting you about pickup sessions and tournaments.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                value={basicsPhone}
                onChange={(e) => setBasicsPhone(e.target.value)}
                disabled={contactBusy}
                placeholder="Phone number"
                inputMode="tel"
                autoComplete="tel"
              />
              <input
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                value={basicsInstagram}
                onChange={(e) => setBasicsInstagram(e.target.value)}
                disabled={contactBusy}
                placeholder="Instagram (@handle)"
                autoComplete="off"
              />
            </div>

            {contactMsg ? (
              <p className="text-sm text-amber-200/90 leading-relaxed whitespace-pre-line">
                {contactMsg}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void saveContact()}
              disabled={contactBusy}
              className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50 sm:w-auto"
            >
              {contactBusy ? "Saving…" : "Save contact"}
            </button>
          </div>

          {msg ? (
            <p className="text-sm text-amber-200/90 leading-relaxed whitespace-pre-line">{msg}</p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:flex-wrap">
            <Link
              href={APP_HOME_URL}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-center text-sm font-medium text-white/90 transition hover:bg-white/10"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-white/15 px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/10"
            >
              Log out
            </button>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
