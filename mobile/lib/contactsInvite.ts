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

/** Digits of a phone number, with a leading US country code dropped, so "(203) 555-0100" and "+1 203 555 0100" match. */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** One entry per phone number, first one wins, so nobody is texted twice. */
export function dedupeByNumber(list: readonly InviteContact[]): InviteContact[] {
  const seen = new Set<string>();
  const out: InviteContact[] = [];
  for (const c of list) {
    const key = phoneKey(c.phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export type InviteSender = {
  isSmsAvailable: () => Promise<boolean>;
  sendSms: (addresses: string[], message: string) => Promise<unknown>;
  share: (message: string) => Promise<unknown>;
};

/**
 * Invites exactly one person. The message composer is only ever given that one number, never a list, so no recipient
 * can see another's number. Without a composer (iPad, simulator) the share sheet carries the same message, with no
 * recipient attached.
 */
export async function inviteOne(contact: InviteContact, message: string, sender: InviteSender): Promise<"composer" | "share"> {
  if (await sender.isSmsAvailable()) {
    await sender.sendSms([contact.phone], message);
    return "composer";
  }
  await sender.share(message);
  return "share";
}
