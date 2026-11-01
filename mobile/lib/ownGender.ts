import { isGenderSettingValue, type GenderSettingValue } from "./genderFilterCopy";

/** The few Supabase calls the Settings gender row makes, typed loosely so a test can fake them. */
type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** The signed-in player's own gender, from the view my_profile_identity (never from `profiles`). Null when unset, unknown or the view is missing. */
export async function readOwnGender(supabase: Client): Promise<GenderSettingValue | null> {
  const res = await supabase.from("my_profile_identity").select("gender").maybeSingle();
  if (res.error) return null;
  const v = (res.data as { gender?: unknown } | null)?.gender;
  return isGenderSettingValue(v) ? v : null;
}

export type WriteOwnGenderResult = { ok: true } | { ok: false; message: string };

/** Writes ONLY the player's own row. Choosing anything but "other" clears the free-text description. */
export async function writeOwnGender(supabase: Client, userId: string, value: GenderSettingValue): Promise<WriteOwnGenderResult> {
  if (!userId) return { ok: false, message: "Sign in again to change this." };
  const patch: Record<string, unknown> = { gender: value, updated_at: new Date().toISOString() };
  if (value !== "other") patch.gender_other = null;
  const res = await supabase.from("profiles").update(patch).eq("id", userId).select("id");
  if (res.error) return { ok: false, message: String(res.error.message ?? "error") };
  if (!Array.isArray(res.data) || res.data.length === 0) return { ok: false, message: "Save did not update any profile row." };
  return { ok: true };
}
