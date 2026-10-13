import { etParts } from "./schedule";

export type EventType = "pickup" | "league" | "tournament";
export type EventFilter = "all" | EventType;
export const EVENT_FILTERS: { key: EventFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pickup", label: "Pickup" },
  { key: "league", label: "Leagues" },
  { key: "tournament", label: "Tournaments" },
];

export type EventRow = {
  id: string;
  title: string;
  event_type: EventType;
  starts_at: string;
  capacity: number | null;
  joined_count: number;
  price_cents: number | null;
  price_unit: "player" | "team" | null;
  source: "manual" | "imported";
  source_note: string | null;
  venue_key: string | null;
  venues: { name: string } | { name: string }[] | null;
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function eventVenueName(e: Pick<EventRow, "venues">): string | null {
  const v = Array.isArray(e.venues) ? e.venues[0] : e.venues;
  return v?.name ?? null;
}

/** "SAT" and 17, in Eastern time. */
export function eventDateBlock(startsAt: string): { weekday: string; day: number } {
  const p = etParts(new Date(startsAt));
  const [y, m, d] = p.date.split("-").map(Number);
  return { weekday: WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!, day: d! };
}

/** "11 AM" or "4:30 PM", Eastern. */
export function eventTimeLabel(startsAt: string): string {
  const p = etParts(new Date(startsAt));
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ap = p.hour < 12 ? "AM" : "PM";
  return p.minute === 0 ? `${h12} ${ap}` : `${h12}:${String(p.minute).padStart(2, "0")} ${ap}`;
}

/** "Free", "$10 each" or "$80 per team". A null price is Free only for a pickup the venue lists as free: unknown stays blank. */
export function eventPriceLabel(e: Pick<EventRow, "price_cents" | "price_unit">): string | null {
  if (e.price_cents == null) return null;
  if (e.price_cents === 0) return "Free";
  const dollars = e.price_cents % 100 === 0 ? `$${e.price_cents / 100}` : `$${(e.price_cents / 100).toFixed(2)}`;
  return e.price_unit === "team" ? `${dollars} per team` : `${dollars} each`;
}

/** "8 of 14 joined", "3 of 8 teams" for a tournament. Null when there is no capacity to compare with. */
export function eventJoinedLabel(e: Pick<EventRow, "capacity" | "joined_count" | "event_type" | "price_unit">): string | null {
  if (e.capacity == null) return null;
  const teams = e.event_type === "tournament" || e.price_unit === "team";
  return teams ? `${e.joined_count} of ${e.capacity} teams` : `${e.joined_count} of ${e.capacity} joined`;
}

/** Imported events say where they came from instead of showing a join count. */
export function eventSourceLabel(e: Pick<EventRow, "source" | "source_note">): string | null {
  if (e.source !== "imported") return null;
  return e.source_note?.trim() || "Imported from town calendar";
}

export function filterEvents(list: EventRow[], f: EventFilter): EventRow[] {
  return f === "all" ? list : list.filter((e) => e.event_type === f);
}
