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
import {
  PROFILE_SELECT,
  profileDisplayName,
  type ProfileRow,
} from "@/lib/profileFields";
import { broadcastProfileUpdated } from "@/lib/profileBroadcast";

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

    const { data: row, error: pErr } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .maybeSingle();

    if (pErr) {
      setMsg(pErr.message);
      setProfile(null);
    } else {
      setProfile(row as ProfileRow | null);
      setAvatarBroken(false);
    }
    setLoading(false);
  }, [router, supabase]);

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
      setMsg(dbErr.message);
      return;
    }

    setAvatarBroken(false);
    setProfile((p) =>
      p
        ? { ...p, avatar_url: publicUrl }
        : {
            first_name: null,
            last_name: null,
            phone: null,
            instagram: null,
            avatar_url: publicUrl,
            tier: null,
          }
    );
    broadcastProfileUpdated();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = "/";
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
          brandHref={APP_HOME_URL}
          fallbackHref={APP_HOME_URL}
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
        brandHref={APP_HOME_URL}
        fallbackHref={APP_HOME_URL}
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
            {fieldRow("Name", profileDisplayName(profile) || null)}
            {fieldRow("Phone", profile?.phone)}
            {fieldRow("Instagram", ig)}
            {fieldRow("Tier", profile?.tier)}
          </dl>

          {msg ? (
            <p className="text-sm text-amber-200/90 leading-relaxed">{msg}</p>
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
