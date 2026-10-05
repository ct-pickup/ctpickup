/** Client flag. Expo only inlines EXPO_PUBLIC_* variables. Off unless the build sets it to "true". */
export const CONTACTS_INVITE_ENABLED = (process.env.EXPO_PUBLIC_CONTACTS_INVITE_ENABLED ?? "").trim().toLowerCase() === "true";

/** One contact that has a phone number. Held in memory on this screen only: never stored, logged or sent to our server. */
export type InviteContact = { id: string; name: string; phone: string };

type RawContact = {
  id?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phoneNumbers?: Array<{ number?: string; digits?: string; isPrimary?: boolean }>;
};

/** The contact's display name, or null when it has none. */
function nameOf(c: RawContact): string | null {
  const n = (c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" ")).trim();
  return n || null;
}

/** The primary phone number (else the first one), or null when the contact has none. */
function phoneOf(c: RawContact): string | null {
  const list = (c.phoneNumbers ?? []).filter((p) => (p.number ?? "").trim());
  const pick = list.find((p) => p.isPrimary) ?? list[0];
  return pick?.number?.trim() || null;
}

/** Contacts that have a name and a phone number, A to Z. */
export function inviteContactsFrom(raw: readonly RawContact[]): InviteContact[] {
  const out: InviteContact[] = [];
  for (const c of raw) {
    const name = nameOf(c);
    const phone = phoneOf(c);
    if (c.id && name && phone) out.push({ id: c.id, name, phone });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive match on name, or on the digits of a number when the query has at least 3 digits. */
export function filterInviteContacts(list: readonly InviteContact[], query: string): InviteContact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  const digits = q.replace(/\D/g, "");
  return list.filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)));
}
