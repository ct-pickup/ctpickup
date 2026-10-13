/** Mirrors the `venues` table (see supabase/migrations/20261012000000_fields_venues_schools.sql). */
export type VenueType = "school_public" | "school_private" | "school_unknown" | "park" | "club" | "other";
export type Access = "public" | "private" | "restricted" | "unknown";
export type PriceStatus = "free" | "paid" | "unknown";
export type PriceSource = "osm" | "manual" | "unknown";
export type BookingMethod = "online" | "phone" | "permit_request" | "unknown";
export type PermitRequired = "yes" | "no" | "unknown";
export type VenueSetting = "outdoor" | "indoor" | "both";
export type PermitType = "permit" | "reservation" | "membership" | "school_use_request" | "walk_up";

export type Venue = {
  venue_key: string;
  state: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
  venue_type: VenueType | null;
  school_key: string | null;
  school_name: string | null;
  school_kind: string | null;
  access: Access | null;
  access_basis: string | null;
  field_count: number | null;
  turf_count: number | null;
  surface: string | null;
  lit: string | null;
  address: string | null;
  website: string | null;
  operator: string | null;
  sport_confidence: string | null;
  osm_ids: string | null;
  priority: number | null;
  price_status: PriceStatus | null;
  price_text: string | null;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  price_source: PriceSource | null;
  booking_method: BookingMethod | null;
  booking_url: string | null;
  booking_phone: string | null;
  booking_basis: string | null;
  permit_required: PermitRequired | null;
  permit_type: PermitType | null;
  /** "tag…" (from map data), "assumed: …" (a guess) or "manual" (a person checked). */
  permit_basis: string | null;
  /** Where the field is. Rows read before the setting column existed have none: treat that as outdoor. */
  setting?: VenueSetting | null;
  verified: boolean;
  last_verified_at: string | null;
  updated_at: string | null;
};

/** A venue as the Fields list shows it: the row plus what the app adds on top of the table. */
export type FieldListing = {
  venue: Venue;
  /** Short place description, e.g. "Town park". */
  kind_label: string;
  distance_mi: number | null;
  /** True only once the venue's calendar is connected (step 4). Until then every time is Unknown. */
  calendar_connected: boolean;
};

export type FieldFilters = { free: boolean; turf: boolean; noPermit: boolean; lights: boolean; indoor: boolean; query: string };
export const NO_FIELD_FILTERS: FieldFilters = { free: false, turf: false, noPermit: false, lights: false, indoor: false, query: "" };
