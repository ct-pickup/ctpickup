import type { FieldFilters, FieldListing, Venue } from "./types";

export type Confirmation = "verified" | "confirming";

function assumed(basis: string | null): boolean {
  return (basis ?? "").trim().toLowerCase().startsWith("assumed");
}

/** Price is Verified once a person checked the venue, or the price was entered by hand. Otherwise we are still confirming. */
export function priceConfirmation(v: Pick<Venue, "verified" | "price_source">): Confirmation {
  return v.verified || v.price_source === "manual" ? "verified" : "confirming";
}

/** A permit rule is Verified only when a person checked it. An "assumed:" basis is never verified, even on a verified row. */
export function permitConfirmation(v: Pick<Venue, "verified" | "permit_basis">): Confirmation {
  if (assumed(v.permit_basis)) return "confirming";
  return v.verified || (v.permit_basis ?? "").trim().toLowerCase() === "manual" ? "verified" : "confirming";
}

export function confirmationLabel(c: Confirmation): string {
  return c === "verified" ? "Verified" : "We're confirming";
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function unitSuffix(unit: string | null): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return "";
  if (u === "hour" || u === "hr" || u === "h") return "/hr";
  return `/${u}`;
}

/** "Free", "$120/hr", "$60–90/hr" or "Price unknown". Never invents a price. */
export function priceLabel(v: Pick<Venue, "price_status" | "price_min" | "price_max" | "price_unit" | "price_text">): string {
  if (v.price_status === "free") return "Free";
  if (v.price_status === "paid") {
    const sfx = unitSuffix(v.price_unit);
    if (v.price_min != null && v.price_max != null && v.price_max > v.price_min) return `${money(v.price_min)}–${money(v.price_max).slice(1)}${sfx}`;
    if (v.price_min != null) return `${money(v.price_min)}${sfx}`;
    if (v.price_max != null) return `${money(v.price_max)}${sfx}`;
    return v.price_text?.trim() || "Paid";
  }
  return "Price unknown";
}

/** Short label for a map pin: "Free", "$120/hr" or "$?". */
export function pinLabel(v: Parameters<typeof priceLabel>[0]): string {
  return v.price_status === "free" || v.price_status === "paid" ? priceLabel(v) : "$?";
}

export type PermitChip = { label: string; tone: "good" | "warn" | "neutral" };

/** Chip next to the price: "No permit", "Permit needed", "Membership", or none when we don't know. */
export function permitChip(v: Pick<Venue, "permit_required" | "permit_type">): PermitChip | null {
  if (v.permit_type === "membership") return { label: "Membership", tone: "warn" };
  if (v.permit_type === "walk_up" || v.permit_required === "no") return { label: "No permit", tone: "good" };
  if (v.permit_required === "yes") return { label: "Permit needed", tone: "warn" };
  return null;
}

/** Detail-row copy for the permit: "Permit needed" plus what kind. */
export function permitDetail(v: Pick<Venue, "permit_required" | "permit_type">): { title: string; sub: string | null } {
  const sub =
    v.permit_type === "school_use_request"
      ? "School facility-use request"
      : v.permit_type === "reservation"
        ? "Reservation"
        : v.permit_type === "membership"
          ? "Membership"
          : v.permit_type === "permit"
            ? "Town permit"
            : v.permit_type === "walk_up"
              ? "Walk up"
              : null;
  if (v.permit_type === "walk_up" || v.permit_required === "no") return { title: "No permit needed", sub };
  if (v.permit_required === "yes" || v.permit_type) return { title: "Permit needed", sub };
  return { title: "Permit unknown", sub };
}

export function hasLights(v: Pick<Venue, "lit">): boolean {
  const l = (v.lit ?? "").trim().toLowerCase();
  return l === "yes" || l === "true";
}

export function isTurf(v: Pick<Venue, "turf_count" | "surface">): boolean {
  return (v.turf_count ?? 0) > 0 || (v.surface ?? "").toLowerCase().includes("turf") || (v.surface ?? "").toLowerCase().includes("artificial");
}

export function isNoPermit(v: Pick<Venue, "permit_required" | "permit_type">): boolean {
  return v.permit_type === "walk_up" || v.permit_required === "no";
}

export function filterFields(list: FieldListing[], f: FieldFilters): FieldListing[] {
  const q = f.query.trim().toLowerCase();
  return list.filter(({ venue: v, kind_label }) => {
    if (f.free && v.price_status !== "free") return false;
    if (f.turf && !isTurf(v)) return false;
    if (f.noPermit && !isNoPermit(v)) return false;
    if (f.lights && !hasLights(v)) return false;
    if (q) {
      const hay = [v.name, v.address, v.school_name, v.operator, kind_label].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** "2 fields", "1 field", or null when the count is unknown. */
export function fieldCountLabel(v: Pick<Venue, "field_count">): string | null {
  if (v.field_count == null || v.field_count < 1) return null;
  return `${v.field_count} ${v.field_count === 1 ? "field" : "fields"}`;
}

export type SlotStatus = "open" | "booked" | "pending" | "unknown";

/**
 * The only place a time can become Open. A time is Open only when the venue's calendar is connected AND nothing is
 * booked then. Without a connected calendar a free-looking time is Unknown. A booking we hold a row for (booked or pending)
 * is real information and always shows, and the player's own request shows as Pending.
 */
export function slotStatus(args: {
  calendarConnected: boolean;
  booked: boolean;
  pending?: boolean;
  yourRequest: boolean;
}): SlotStatus {
  if (args.yourRequest) return "pending";
  if (args.booked) return "booked";
  if (args.pending) return "pending";
  return args.calendarConnected ? "open" : "unknown";
}

/** Whole hours × hourly price. Null when the venue is paid with no usable hourly price, or the price is not per hour. */
export function requestEstimate(v: Pick<Venue, "price_status" | "price_min" | "price_unit">, hours: number): { label: string; cents: number | null } {
  if (v.price_status === "free") return { label: "Free", cents: 0 };
  const unit = (v.price_unit ?? "").trim().toLowerCase();
  const perHour = unit === "hour" || unit === "hr" || unit === "h";
  if (v.price_status === "paid" && v.price_min != null && perHour) {
    const cents = Math.round(v.price_min * 100 * hours);
    return { label: money(cents / 100), cents };
  }
  return { label: "Price to be confirmed", cents: null };
}
