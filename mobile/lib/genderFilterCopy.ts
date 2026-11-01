/** Copy and option lists for the gender leaderboard filter and the Settings gender row. Pure. No em dashes, no tier or wave wording. */
export type GenderFilterValue = "all" | "male" | "female";
export type GenderSettingValue = "male" | "female" | "other" | "prefer_not_to_say";

export const GENDER_FILTER_OPTIONS: ReadonlyArray<{ value: GenderFilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];
export const GENDER_FILTER_TITLE = "Gender";
export const GENDER_FILTER_EMPTY_TITLE = "No players here yet";
export const GENDER_FILTER_EMPTY_BODY = "No one on this list yet. Try All to see everyone.";

export const GENDER_SETTING_OPTIONS: ReadonlyArray<{ value: GenderSettingValue; label: string }> = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
export const GENDER_SETTING_LABEL = "Gender";
export const GENDER_SETTING_HELP = "Used for gender leaderboards. Others can see which list you appear on.";
export const GENDER_SETTING_UNSET = "Not set";
export const GENDER_SAVE_ERROR = "We couldn't save that. Please try again.";

/** The label on the filter chip: "Gender: All", "Gender: Male", "Gender: Female". */
export function genderChipLabel(value: GenderFilterValue): string {
  return `${GENDER_FILTER_TITLE}: ${GENDER_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? "All"}`;
}

export function genderSettingLabel(value: string | null | undefined): string {
  return GENDER_SETTING_OPTIONS.find((o) => o.value === value)?.label ?? GENDER_SETTING_UNSET;
}

export function isGenderSettingValue(v: unknown): v is GenderSettingValue {
  return GENDER_SETTING_OPTIONS.some((o) => o.value === v);
}
