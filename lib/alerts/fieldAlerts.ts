import type { SupabaseClient } from "@supabase/supabase-js";

import { usersWithFlagOn } from "@/lib/flags";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import {
  ALERT_RATE_WINDOW_HOURS,
  freedWindows,
  gameMovedCopy,
  newGameCopy,
  slotDedupeKey,
  slotOpenCopy,
  venueChangeCopy,
  wantedBy,
  withinRadius,
  type AlertPrefRow,
  type AlertType,
  type VenueChange,
  type Window,
} from "@/lib/alerts/alertRules";

/**
 * Senders for the Fields alerts. Every send goes through the same four gates, in this order:
 *   1. the 'fields' flag is ON for the player (nobody gets a push for a feature they cannot see),
 *   2. the player's alert switch for this type (no row means the default),
 *   3. the push ledger: at most one push of this type per player per 6 hours, and never the same event twice,
 *   4. the push policy in sendPushToUsers (category switches and quiet hours).
 * All of them swallow errors: an alert must never break the request that triggered it.
 */

const IN_CHUNK = 200;

async function prefRows(admin: SupabaseClient, type: AlertType, userIds: string[]): Promise<AlertPrefRow[]> {
  const out: AlertPrefRow[] = [];
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const { data, error } = await admin.from("alert_subscriptions").select("user_id,alert_type,enabled,radius_miles").eq("alert_type", type).in("user_id", userIds.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as AlertPrefRow[]));
  }
  return out;
}

/** Flag, then preference. Returns player id -> radius in miles. */
export async function recipientsForAlert(admin: SupabaseClient, type: AlertType, candidateIds: string[]): Promise<Map<string, number>> {
  const flagged = await usersWithFlagOn(admin, "fields", candidateIds);
  if (!flagged.length) return new Map();
  return wantedBy(flagged, await prefRows(admin, type, flagged), type);
}

/** Claims the rate-limit and de-dupe slots. Returns the players who may be pushed now. Any error means nobody. */
export async function claimAlertSlots(admin: SupabaseClient, userIds: string[], bucket: string, dedupeKey: string, windowHours: number = ALERT_RATE_WINDOW_HOURS): Promise<string[]> {
  if (!userIds.length) return [];
  const { data, error } = await admin.rpc("claim_push_slots", { p_user_ids: userIds, p_bucket: bucket, p_dedupe_key: dedupeKey, p_window_hours: windowHours });
  if (error || !Array.isArray(data)) return [];
  return (data as { user_id?: string }[]).map((r) => r.user_id).filter((id): id is string => typeof id === "string");
}

async function approvedProfilesWithZip(admin: SupabaseClient, exclude: Set<string>): Promise<{ id: string; zip_code: string | null }[]> {
  const out: { id: string; zip_code: string | null }[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await admin.from("profiles").select("id,zip_code").eq("approved", true).not("zip_code", "is", null).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; zip_code: string | null }[];
    out.push(...rows.filter((r) => !exclude.has(r.id)));
    if (rows.length < PAGE) break;
  }
  return out;
}

export type NewGame = { id: string; hostId: string; startAt: string | null; timeTbd: boolean; place: string | null; lat: number | null; lng: number | null };

/**
 * A new public game. Pushes the players who asked for "New games near me" and live within their radius, skipping the host and
 * anyone the region push already reached. Returns how many were pushed.
 */
export async function notifyNewGame(admin: SupabaseClient, game: NewGame, alreadyNotified: Iterable<string> = []): Promise<number> {
  try {
    if (game.lat == null || game.lng == null) return 0;
    const skip = new Set<string>([game.hostId, ...alreadyNotified]);
    const profiles = await approvedProfilesWithZip(admin, skip);
    const wants = await recipientsForAlert(admin, "new_games", profiles.map((p) => p.id));
    const near = withinRadius(profiles.filter((p) => wants.has(p.id)), { lat: game.lat, lng: game.lng }, wants);
    const ids = await claimAlertSlots(admin, near, "new_games", `game:${game.id}`);
    if (!ids.length) return 0;
    const copy = newGameCopy(game.startAt, game.timeTbd, game.place);
    await sendPushToUsers(admin, ids, { ...copy, data: { kind: "fields_new_game", run_id: game.id, screen: `session/${game.id}`, url: `ctpickup://session/${game.id}` } });
    return ids.length;
  } catch (e) {
    console.error("[field-alerts] new game failed", e instanceof Error ? e.message : e);
    return 0;
  }
}

async function savedVenueUsers(admin: SupabaseClient, venueKey: string): Promise<string[]> {
  const { data, error } = await admin.from("saved_venues").select("user_id").eq("venue_key", venueKey).limit(5000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

/** A booked time at a saved field was freed (the calendar no longer lists it). */
export async function notifySlotOpened(admin: SupabaseClient, venueKey: string, venueName: string, before: Window[], after: Window[], now: Date = new Date()): Promise<number> {
  try {
    const freed = freedWindows(before, after, now);
    if (!freed.length) return 0;
    const wants = await recipientsForAlert(admin, "slot_opens", await savedVenueUsers(admin, venueKey));
    const ids = await claimAlertSlots(admin, [...wants.keys()], "slot_opens", slotDedupeKey(venueKey, freed));
    if (!ids.length) return 0;
    await sendPushToUsers(admin, ids, { ...slotOpenCopy(venueName, freed), data: { kind: "fields_slot_open", screen: "field", venue_key: venueKey } });
    return ids.length;
  } catch (e) {
    console.error("[field-alerts] slot opened failed", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** A saved field was closed or removed. */
export async function notifyVenueChange(admin: SupabaseClient, venueKey: string, venueName: string, change: VenueChange, until?: string | null): Promise<number> {
  try {
    const wants = await recipientsForAlert(admin, "changes_cancellations", await savedVenueUsers(admin, venueKey));
    const ids = await claimAlertSlots(admin, [...wants.keys()], "changes_cancellations", `venue:${venueKey}:${change}:${until ?? ""}`);
    if (!ids.length) return 0;
    await sendPushToUsers(admin, ids, { ...venueChangeCopy(venueName, change, until), data: { kind: "fields_change", screen: "field", venue_key: venueKey } });
    return ids.length;
  } catch (e) {
    console.error("[field-alerts] venue change failed", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** A game the player joined moved (new time or place). Cancellations keep their own push. */
export async function notifyGameMoved(admin: SupabaseClient, run: { id: string; title: string | null; startAt: string | null }, moved: { time: boolean; place: boolean }): Promise<number> {
  try {
    if (!moved.time && !moved.place) return 0;
    const { data, error } = await admin.from("pickup_run_rsvps").select("user_id").eq("run_id", run.id).eq("status", "confirmed");
    if (error) throw new Error(error.message);
    const joined = ((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((id): id is string => !!id);
    const wants = await recipientsForAlert(admin, "changes_cancellations", joined);
    const ids = await claimAlertSlots(admin, [...wants.keys()], "changes_cancellations", `run:${run.id}:${run.startAt ?? ""}:${moved.time ? "t" : ""}${moved.place ? "p" : ""}`);
    if (!ids.length) return 0;
    await sendPushToUsers(admin, ids, { ...gameMovedCopy(run.title, run.startAt, moved), data: { kind: "fields_change", run_id: run.id, screen: `session/${run.id}`, url: `ctpickup://session/${run.id}` } });
    return ids.length;
  } catch (e) {
    console.error("[field-alerts] game moved failed", e instanceof Error ? e.message : e);
    return 0;
  }
}
