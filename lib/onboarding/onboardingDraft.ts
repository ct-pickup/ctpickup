import type {
  EsportsConsole,
  EsportsInterest,
  EsportsPlatform,
} from "@/lib/profilePreferences";

export const ONBOARDING_DRAFT_STORAGE_KEY = "ctpickup_onboarding_draft_v1";

export type OnboardingDraftV1 = {
  v: 1;
  userId: string;
  firstName: string;
  lastName: string;
  instagram: string;
  phone: string;
  waiverAccepted: boolean;
  esportsInterest: EsportsInterest | null;
  esportsPlatform: EsportsPlatform | null;
  esportsConsole: EsportsConsole | null;
  esportsOnlineId: string;
};

export function readOnboardingDraft(): OnboardingDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingDraftV1;
    if (parsed?.v !== 1 || typeof parsed.userId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeOnboardingDraft(draft: OnboardingDraftV1): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
