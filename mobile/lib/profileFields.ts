export type ProfileNameRow = {
  first_name: string | null;
  last_name: string | null;
  username?: string | null;
};

export function profileDisplayName(row: ProfileNameRow | null): string {
  const combined = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  return combined;
}
