import { isGenderSettingValue } from "./genderFilterCopy";

/** Copy and rules for the one-time "Leaderboards now have a Gender filter" notice. Pure, so tests can pin the wording and the show-once rule. */
export const GENDER_NOTICE_TITLE = "Leaderboards now have a Gender filter";
export const GENDER_NOTICE_BODY = "Your list is based on the gender you gave at signup. You can change it anytime in Settings.";
export const GENDER_NOTICE_BODY_BLANK = "Add your gender in Settings to appear on a gender list.";
export const GENDER_NOTICE_OK = "OK";
export const GENDER_NOTICE_SETTINGS = "Go to Settings";

/** Device-local flag, one per player, same pattern as the cancellation policy notice. Bump the version to show it again. */
const STORAGE_KEY_PREFIX = "ctpickup_gender_notice_v1:";
export const genderNoticeKey = (userId: string): string => `${STORAGE_KEY_PREFIX}${userId}`;

/** The body for a player: blank gender gets the "add yours" line. An unknown value (the read failed) gets the standard line. */
export function genderNoticeBody(gender: string | null | undefined, readFailed = false): string {
  if (readFailed) return GENDER_NOTICE_BODY;
  const blank = !isGenderSettingValue(gender);
  return blank ? GENDER_NOTICE_BODY_BLANK : GENDER_NOTICE_BODY;
}

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/** True the first time on this device for this player; false once it was shown (or if storage cannot be read, so nobody is nagged). */
export async function shouldShowGenderNotice(storage: Storage, userId: string): Promise<boolean> {
  try {
    return (await storage.getItem(genderNoticeKey(userId))) !== "1";
  } catch {
    return false;
  }
}

export async function markGenderNoticeSeen(storage: Storage, userId: string): Promise<void> {
  try {
    await storage.setItem(genderNoticeKey(userId), "1");
  } catch {
    /* the notice may show again next launch; nothing else depends on it */
  }
}
