"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HistoryBack } from "@/components/layout";
import { APP_HOME_FIRST_VISIT_URL } from "@/lib/siteNav";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CURRENT_WAIVER_VERSION } from "@/lib/waiver/constants";
import { useTransitionNav } from "@/components/TransitionNavContext";

type Stage = "email" | "code" | "profile";

const LEFT_IMAGE = "/signup/left.jpg";
const RIGHT_IMAGE = "/signup/right.jpg";

function SidePhoto({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="hidden xl:block w-[280px]">
      <div className="overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.03] shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <img
          src={src}
          alt={alt}
          className="h-[560px] w-full object-cover"
        />
      </div>
    </div>
  );
}

function StepBadge({
  number,
  label,
  active,
  done,
}: {
  number: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "relative flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-all duration-300",
          done
            ? "border-white bg-white text-black"
            : active
            ? "border-white/40 bg-white/10 text-white"
            : "border-white/15 bg-transparent text-white/45",
        ].join(" ")}
      >
        {done ? "✓" : number}
      </div>

      <div className="flex flex-col">
        <span
          className={[
            "text-[11px] uppercase tracking-[0.18em]",
            active || done ? "text-white/80" : "text-white/35",
          ].join(" ")}
        >
          Step {number}
        </span>
        <span
          className={[
            "text-sm font-medium",
            active ? "text-white" : done ? "text-white/80" : "text-white/45",
          ].join(" ")}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function InfoIcon() {
  return (
    <div className="group relative inline-flex">
      <div className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-white/20 text-[11px] font-semibold text-white/75">
        i
      </div>

      <div className="pointer-events-none absolute left-7 top-1/2 z-20 hidden w-[280px] -translate-y-1/2 rounded-xl border border-white/10 bg-black px-3 py-2 text-xs leading-relaxed text-white/75 shadow-xl group-hover:block group-focus-within:block">
        We’ll only store your personal information once. If you run into issues,
        someone from CT Pickup may be able to help.
      </div>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const transitionNav = useTransitionNav();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [waiverAccepted, setWaiverAccepted] = useState(false);

  const emailClean = useMemo(() => email.trim().toLowerCase(), [email]);

  const emailLooksValid = useMemo(() => {
    if (emailClean.length < 6) return false;
    if (!emailClean.includes("@")) return false;
    const [a, b] = emailClean.split("@");
    if (!a || !b) return false;
    if (!b.includes(".")) return false;
    return true;
  }, [emailClean]);

  const canSaveProfile = useMemo(() => {
    return (
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      phone.trim().length > 0 &&
      instagram.trim().length > 0 &&
      waiverAccepted
    );
  }, [firstName, lastName, phone, instagram, waiverAccepted]);

  async function checkExists() {
    const r = await fetch("/api/auth/email-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailClean }),
    });
    const j = await r.json();
    return !!j?.exists;
  }

  async function sendCode() {
    if (!emailLooksValid || busy) return;

    setBusy(true);
    setMsg(null);

    const exists = await checkExists();
    if (exists) {
      setBusy(false);
      setMsg("You already have this account on file. Please log in with that email.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailClean,
      options: {
        emailRedirectTo: `${window.location.origin}${APP_HOME_FIRST_VISIT_URL}`,
      },
    });

    setBusy(false);
    if (error) return setMsg(error.message);

    setStage("code");
    setMsg("Code sent. Check your email.");
  }

  async function verifyCode() {
    if (!code.trim() || busy) return;

    setBusy(true);
    setMsg(null);

    const { error } = await supabase.auth.verifyOtp({
      email: emailClean,
      token: code.trim(),
      type: "email",
    });

    setBusy(false);
    if (error) return setMsg(error.message);

    setStage("profile");
    setMsg(null);
  }

  async function saveProfileAndContinue() {
    if (!canSaveProfile || busy) return;

    setBusy(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const user = auth.user;

      if (authErr || !user) {
        setBusy(false);
        setMsg("Session not found. Please verify your code again.");
        return;
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          instagram: instagram.trim(),
        },
        { onConflict: "id" }
      );

      if (error) {
        setBusy(false);
        setMsg(error.message);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setBusy(false);
        setMsg("Session not found. Please verify your code again.");
        return;
      }

      const acceptRes = await fetch("/api/waiver/accept", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ acknowledge: true }),
      });

      setBusy(false);
      if (!acceptRes.ok) {
        const aj = await acceptRes.json().catch(() => ({}));
        setMsg(
          typeof aj?.error === "string"
            ? `Could not record waiver acceptance (${aj.error.replace(/_/g, " ")}).`
            : "Could not record waiver acceptance. Please try again."
        );
        return;
      }

      setTransitioning(true);
      setTimeout(() => {
        if (transitionNav) {
          transitionNav.navigateWithTransition(APP_HOME_FIRST_VISIT_URL);
        } else {
          router.push(APP_HOME_FIRST_VISIT_URL);
        }
      }, 260);
    } catch (e: any) {
      setBusy(false);
      setMsg(e?.message || "Something went wrong.");
    }
  }

  const currentStep = stage === "email" ? 1 : stage === "code" ? 2 : 3;

  return (
    <main className="min-h-screen bg-black text-white">
      <div
        className={[
          "fixed inset-0 bg-black pointer-events-none transition-opacity duration-300",
          transitioning ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div className="text-base md:text-lg font-semibold tracking-wide text-white/90">
            CT Pickup
          </div>

          <HistoryBack
            fallbackHref="/"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm text-white/70 underline-offset-4 transition hover:text-white hover:underline"
          />
        </div>

        <div className="flex items-center justify-center gap-10">
          <SidePhoto src={LEFT_IMAGE} alt="CT Pickup left" />

          <div className="w-full max-w-[420px]">
            <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5 md:p-6 shadow-[0_20px_70px_rgba(0,0,0,0.34)]">
              <div className="space-y-3">
                <h1 className="text-4xl md:text-[52px] font-semibold uppercase tracking-tight">
                  Sign Up
                </h1>

                <p className="text-sm md:text-base text-white/75 leading-relaxed">
                  Sign up to save your info and manage your invites.
                </p>

                <p className="text-sm text-white/60 leading-relaxed">
                  We’ll email you a verification code, so no password is needed. Use your
                  primary email.
                </p>

                <div className="pt-1">
                  <InfoIcon />
                </div>
              </div>

              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <StepBadge number={1} label="Email" active={currentStep === 1} done={currentStep > 1} />
                  <StepBadge number={2} label="Verify" active={currentStep === 2} done={currentStep > 2} />
                  <StepBadge number={3} label="Profile" active={currentStep === 3} done={false} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-5 space-y-4">
                {stage === "email" && (
                  <>
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                      inputMode="email"
                      autoComplete="email"
                    />

                    <button
                      className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-50"
                      onClick={sendCode}
                      disabled={!emailLooksValid || busy}
                    >
                      {busy ? "Continuing..." : "Continue"}
                    </button>
                  </>
                )}

                {stage === "code" && (
                  <>
                    <input
                      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                      placeholder="6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={busy}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />

                    <button
                      className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-50"
                      onClick={verifyCode}
                      disabled={!code.trim() || busy}
                    >
                      {busy ? "Verifying..." : "Continue"}
                    </button>

                    <button
                      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white/85 hover:bg-white/[0.04]"
                      onClick={() => {
                        setStage("email");
                        setCode("");
                        setMsg(null);
                      }}
                      disabled={busy}
                    >
                      Back
                    </button>
                  </>
                )}

                {stage === "profile" && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <input
                        className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                        placeholder="First Name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={busy}
                      />

                      <input
                        className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                        placeholder="Last Name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={busy}
                      />
                    </div>

                    <input
                      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                      placeholder="Phone Number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={busy}
                      inputMode="tel"
                      autoComplete="tel"
                    />

                    <input
                      className="w-full rounded-xl border border-white/15 bg-black px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                      placeholder="Instagram Handle"
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                      disabled={busy}
                    />

                    <label className="flex cursor-pointer items-start gap-3 text-left text-sm leading-relaxed text-white/75">
                      <input
                        type="checkbox"
                        checked={waiverAccepted}
                        onChange={(e) => setWaiverAccepted(e.target.checked)}
                        disabled={busy}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-white/30 bg-black"
                      />
                      <span>
                        I agree to the{" "}
                        <Link
                          href="/liability-waiver"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-white underline-offset-4 hover:underline"
                        >
                          Liability Waiver &amp; Participation Agreement
                        </Link>{" "}
                        ({CURRENT_WAIVER_VERSION}), including eligibility (13+; parental
                        consent if under 18). I understand I must accept the current waiver
                        version to use tournaments and related services.
                      </span>
                    </label>

                    <button
                      className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-50"
                      onClick={saveProfileAndContinue}
                      disabled={!canSaveProfile || busy}
                    >
                      {busy ? "Saving..." : "Finish Sign Up"}
                    </button>
                  </>
                )}

                {msg ? <p className="text-sm text-white/70">{msg}</p> : null}

                {msg?.includes("already have this account") && (
                  <Link
                    href="/login"
                    className="block text-sm text-white/70 hover:text-white hover:underline underline-offset-4"
                  >
                    Go to log in
                  </Link>
                )}
              </div>
            </div>
          </div>

          <SidePhoto src={RIGHT_IMAGE} alt="CT Pickup right" />
        </div>
      </div>
    </main>
  );
}