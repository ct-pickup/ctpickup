export type ProfileGender = "male" | "female" | "other";

export const PROFILE_GENDER_LABELS: Record<ProfileGender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export const PROFILE_GENDER_OTHER_MAX_LEN = 64;
export const PROFILE_PLAYING_POSITION_MAX_LEN = 64;

export function parseProfileGender(raw: string | null | undefined): ProfileGender | null {
  if (raw === "male" || raw === "female" || raw === "other") return raw;
  return null;
}

export function normalizeGenderOther(raw: string | null | undefined): string | null {
  const t = String(raw ?? "")
    .trim()
    .slice(0, PROFILE_GENDER_OTHER_MAX_LEN);
  return t.length > 0 ? t : null;
}

export function normalizePlayingPosition(raw: string | null | undefined): string | null {
  const t = String(raw ?? "")
    .trim()
    .slice(0, PROFILE_PLAYING_POSITION_MAX_LEN);
  return t.length > 0 ? t : null;
}

export function profileIdentityColumns(args: {
  firstName: string;
  lastName: string;
  gender: ProfileGender;
  genderOther: string;
  playingPosition: string;
}): {
  first_name: string;
  last_name: string;
  gender: ProfileGender;
  gender_other: string | null;
  playing_position: string;
} {
  return {
    first_name: args.firstName.trim(),
    last_name: args.lastName.trim(),
    gender: args.gender,
    gender_other: args.gender === "other" ? normalizeGenderOther(args.genderOther) : null,
    playing_position: normalizePlayingPosition(args.playingPosition) ?? "",
  };
}

