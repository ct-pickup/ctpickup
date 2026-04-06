import type {
  EsportsConsole,
  EsportsInterest,
  EsportsPlatform,
} from "@/lib/profilePreferences";

export const SIGNUP_DRAFT_STORAGE_KEY = "ctpickup_signup_draft_v1";

export type SignupDraftV1 = {
  v: 1;
  /** Present after OTP verification (profile stage). */
  userId: string | null;
  stage: "email" | "code" | "profile";
  email: string;
  code: string;
  firstName: string;
  lastName: string;
  phone: string;
  instagram: string;
  waiverAccepted: boolean;
  esportsInterest: EsportsInterest | null;
  esportsPlatform: EsportsPlatform | null;
  esportsConsole: EsportsConsole | null;
  esportsOnlineId: string;
  playsGoalie: boolean | null;
};

export function readSignupDraft(): SignupDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SignupDraftV1;
    if (parsed?.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSignupDraft(draft: SignupDraftV1): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota / private mode
  }
}

export function clearSignupDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
