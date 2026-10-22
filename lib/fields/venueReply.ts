import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Record the reply": what a venue answered to a field request, how it changes the request, and (if the admin ticks Apply) the
 * field page. Every venue change is written to venue_data_events with its old and new value so it can be undone.
 * Server only (service role). The pure parts (validate, buildReplyChanges, statusForOutcome) have no database access.
 */

export const OUTCOMES = ["approved", "denied", "needs_permit", "pending", "no_answer"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const PRICE_UNITS = ["hour", "game", "season", "day"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];
export const RESIDENCY = ["residents_only", "non_resident_fee", "open"] as const;
export type Residency = (typeof RESIDENCY)[number];

export const RESIDENCY_LABEL: Record<Residency, string> = { residents_only: "Residents only", non_resident_fee: "Non-resident fee", open: "Open to all" };

export type ReplyInput = {
  replied_by_name: string | null;
  replied_by_contact: string | null;
  /** YYYY-MM-DD */
  replied_at: string;
  outcome: Outcome;
  price_amount: number | null;
  price_unit: PriceUnit | null;
  permit_required: "yes" | "no" | null;
  residency_rule: Residency | null;
  how_to_book: string | null;
  contact: string | null;
  notes: string | null;
  /** Ticked when the answer came directly from the venue. Only then is the price / permit marked as confirmed. */
  from_venue: boolean;
  /** "No field available that day": kept as an availability note, never a change to the venue. */
  no_field_that_day: boolean;
};

type Row = Record<string, unknown>;

const clean = (v: unknown, max = 2000): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

/** Reads an untrusted body into a ReplyInput, or returns what is wrong with it. */
export function parseReplyInput(body: Record<string, unknown>): { ok: true; input: ReplyInput } | { ok: false; error: string } {
  const outcome = body.outcome;
  if (!OUTCOMES.includes(outcome as Outcome)) return { ok: false, error: "Choose an outcome." };
  const repliedAt = typeof body.replied_at === "string" ? body.replied_at.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(repliedAt) || Number.isNaN(Date.parse(`${repliedAt}T12:00:00Z`))) return { ok: false, error: "The date must look like 2026-10-15." };
  let amount: number | null = null;
  if (body.price_amount !== undefined && body.price_amount !== null && body.price_amount !== "") {
    amount = typeof body.price_amount === "number" ? body.price_amount : Number(String(body.price_amount).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return { ok: false, error: "The price must be a number, 0 or more." };
  }
  const unit = body.price_unit === undefined || body.price_unit === null || body.price_unit === "" ? null : body.price_unit;
  if (unit !== null && !PRICE_UNITS.includes(unit as PriceUnit)) return { ok: false, error: "Choose hour, game, season or day." };
  if (amount !== null && amount > 0 && unit === null) return { ok: false, error: "Choose what the price is per (hour, game, season or day)." };
  const permit = body.permit_required === undefined || body.permit_required === null || body.permit_required === "" ? null : body.permit_required;
  if (permit !== null && permit !== "yes" && permit !== "no") return { ok: false, error: "Permit required must be yes or no." };
  const residency = body.residency_rule === undefined || body.residency_rule === null || body.residency_rule === "" ? null : body.residency_rule;
  if (residency !== null && !RESIDENCY.includes(residency as Residency)) return { ok: false, error: "Choose a residency rule." };
  return {
    ok: true,
    input: {
      replied_by_name: clean(body.replied_by_name, 200),
      replied_by_contact: clean(body.replied_by_contact, 200),
      replied_at: repliedAt,
      outcome: outcome as Outcome,
      price_amount: amount,
      price_unit: (unit as PriceUnit | null) ?? null,
      permit_required: (permit as "yes" | "no" | null) ?? null,
      residency_rule: (residency as Residency | null) ?? null,
      how_to_book: clean(body.how_to_book, 500),
      contact: clean(body.contact, 300),
      notes: clean(body.notes, 2000),
      from_venue: body.from_venue !== false,
      no_field_that_day: body.no_field_that_day === true,
    },
  };
}

/** Request status after a reply. There is no separate "replied" status: approved, declined or waiting on the venue. */
export function statusForOutcome(outcome: Outcome, current: string): string {
  if (outcome === "approved") return "approved";
  if (outcome === "denied") return "declined";
  if (outcome === "needs_permit" || outcome === "pending") return "waiting_on_school";
  return current === "new" ? "waiting_on_school" : current; // no answer: keep it moving, never undo progress
}

/**
 * apply:        approved / needs permit / pending: the answers become venue data
 * availability: a denial or "no field that day": a dated availability note only, nothing permanent
 * none:         no answer: nothing to write
 */
export function modeFor(input: ReplyInput): "apply" | "availability" | "none" {
  if (input.no_field_that_day || input.outcome === "denied") return "availability";
  if (input.outcome === "no_answer") return "none";
  return "apply";
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const PHONE = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
const URL_RE = /https?:\/\/[^\s]+/i;

const mergeLocks = (existing: unknown, add: string[]): string[] => [...new Set([...(Array.isArray(existing) ? (existing as string[]) : []), ...add])];

/**
 * The venue columns a reply changes (only ones whose value really changes). A reply that came from the venue sets the markers the
 * app shows as Verified (price_source and permit_basis = manual, last_verified_at) and locks price / permit / booking so imports
 * never overwrite them. A reply that did not come from the venue writes the values but leaves them as "We're confirming".
 */
export function buildReplyChanges(venue: Row, input: ReplyInput, nowIso: string): { mode: "apply" | "availability" | "none"; changes: Row } {
  const mode = modeFor(input);
  const changes: Row = {};
  const set = (k: string, v: unknown) => {
    if (!same(venue[k], v)) changes[k] = v ?? null;
  };

  if (mode === "availability") {
    const what = input.outcome === "denied" ? "Denied" : "No field available";
    const detail = input.notes ?? input.how_to_book ?? "no details given";
    const line = `[${input.replied_at}] ${what}: ${detail}`;
    const base = typeof venue.availability_notes === "string" ? venue.availability_notes.trim() : "";
    set("availability_notes", base ? `${base}\n${line}` : line);
    return { mode, changes };
  }
  if (mode === "none") return { mode, changes };

  const locks: string[] = [];
  let verifiedAny = false;

  if (input.price_amount !== null) {
    if (input.price_amount === 0) {
      set("price_status", "free");
      set("price_text", "Free");
      set("price_min", null);
      set("price_max", null);
      set("price_unit", null);
    } else {
      set("price_status", "paid");
      set("price_text", `$${input.price_amount}/${input.price_unit}`);
      set("price_min", input.price_amount);
      set("price_max", input.price_amount);
      set("price_unit", input.price_unit);
    }
    if (input.from_venue) {
      set("price_source", "manual");
      verifiedAny = true;
    }
    locks.push("price");
  }

  const permit = input.permit_required ?? (input.outcome === "needs_permit" ? "yes" : null);
  if (permit) {
    set("permit_required", permit);
    if (permit === "yes") {
      if (!venue.permit_type) set("permit_type", "permit");
    } else if (venue.permit_type === "permit") set("permit_type", null);
    set("permit_basis", input.from_venue ? "manual" : `reply: ${input.replied_by_name ?? "venue"} ${input.replied_at}`);
    if (input.from_venue) verifiedAny = true;
    locks.push("permit");
  }

  if (input.how_to_book) {
    const url = URL_RE.exec(input.how_to_book)?.[0] ?? null;
    if (url) {
      set("booking_url", url);
      set("booking_method", "online");
    } else if (input.outcome === "needs_permit") set("booking_method", "permit_request");
    set("booking_basis", input.how_to_book);
    locks.push("booking");
  }
  if (input.contact) {
    set("contact_text", input.contact);
    if (!input.contact.includes("@")) {
      const phone = PHONE.exec(input.contact)?.[1]?.trim();
      if (phone) {
        set("booking_phone", phone);
        if (!locks.includes("booking")) locks.push("booking");
      }
    }
    locks.push("contact");
  }
  if (input.residency_rule) {
    set("residency_rule", RESIDENCY_LABEL[input.residency_rule]);
    locks.push("residency");
  }
  if (input.from_venue && (verifiedAny || input.how_to_book || input.contact)) set("last_verified_at", nowIso);

  if (Object.keys(changes).length > 0 && locks.length > 0) set("locked_fields", mergeLocks(venue.locked_fields, locks));
  return { mode, changes };
}

type Admin = SupabaseClient;
export type RequestRow = { id: string; user_id: string; venue_key: string; status: string; requested_date: string; start_time: string; duration_hours: number };

export type ApplyResult =
  | { ok: false; error: "request_missing" | "venue_missing" }
  | { ok: true; replyId: string; mode: "apply" | "availability" | "none"; fields: string[]; request: RequestRow; previousStatus: string; newStatus: string };

/**
 * Saves the reply, writes the venue changes and their audit events (when applyToVenue), and moves the request to its new status.
 */
export async function applyReply(admin: Admin, args: { requestId: string; adminId: string; input: ReplyInput; applyToVenue: boolean; nowIso?: string; newId?: () => string }): Promise<ApplyResult> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const newId = args.newId ?? (() => crypto.randomUUID());
  const { data: reqData, error: re } = await admin.from("venue_requests").select("id,user_id,venue_key,status,requested_date,start_time,duration_hours").eq("id", args.requestId).maybeSingle();
  if (re) throw new Error(re.message);
  const request = reqData as RequestRow | null;
  if (!request) return { ok: false, error: "request_missing" };
  const { data: vData, error: ve } = await admin.from("venues").select("*").eq("venue_key", request.venue_key).maybeSingle();
  if (ve) throw new Error(ve.message);
  const venue = vData as Row | null;
  if (!venue) return { ok: false, error: "venue_missing" };

  const { mode, changes } = args.applyToVenue ? buildReplyChanges(venue, args.input, nowIso) : { mode: "none" as const, changes: {} as Row };
  const newStatus = statusForOutcome(args.input.outcome, request.status);
  const replyId = newId();

  const { error: ie } = await admin.from("venue_replies").insert({
    id: replyId,
    request_id: request.id,
    venue_key: request.venue_key,
    replied_by_name: args.input.replied_by_name,
    replied_by_contact: args.input.replied_by_contact,
    replied_at: args.input.replied_at,
    outcome: args.input.outcome,
    price_amount: args.input.price_amount,
    price_unit: args.input.price_unit,
    permit_required: args.input.permit_required,
    residency_rule: args.input.residency_rule,
    how_to_book: args.input.how_to_book,
    contact: args.input.contact,
    notes: args.input.notes,
    from_venue: args.input.from_venue,
    no_field_that_day: args.input.no_field_that_day,
    apply_to_venue: args.applyToVenue,
    apply_mode: mode,
    previous_status: request.status,
    new_status: newStatus,
    created_by: args.adminId,
  });
  if (ie) throw new Error(ie.message);

  const fields = Object.keys(changes);
  if (fields.length > 0) {
    const { error: ue } = await admin.from("venues").update({ ...changes, updated_at: nowIso }).eq("venue_key", request.venue_key);
    if (ue) throw new Error(ue.message);
    const events = fields.map((field) => ({
      id: newId(),
      venue_key: request.venue_key,
      field,
      old_value: venue[field] ?? null,
      new_value: changes[field] ?? null,
      source: "reply",
      request_id: request.id,
      reply_id: replyId,
      changed_by: args.adminId,
      changed_at: nowIso,
    }));
    const { error: ee } = await admin.from("venue_data_events").insert(events);
    if (ee) throw new Error(ee.message);
  }

  if (newStatus !== request.status) {
    const { error: se } = await admin.from("venue_requests").update({ status: newStatus }).eq("id", request.id);
    if (se) throw new Error(se.message);
  }
  return { ok: true, replyId, mode, fields, request, previousStatus: request.status, newStatus };
}

export type UndoResult = { ok: false; error: "missing" | "already" } | { ok: true; restored: string[]; skipped: string[]; statusRestored: boolean };

/**
 * Puts back the old value of every field the reply changed. A field someone changed again since is left alone and reported as
 * skipped, so an undo never overwrites newer work. The request goes back to its earlier status if nobody moved it since.
 */
export async function undoReply(admin: Admin, replyId: string, adminId: string, nowIso: string = new Date().toISOString()): Promise<UndoResult> {
  const { data: rData, error: re } = await admin.from("venue_replies").select("*").eq("id", replyId).maybeSingle();
  if (re) throw new Error(re.message);
  const reply = rData as { id: string; request_id: string; venue_key: string; previous_status: string | null; new_status: string | null; undone_at: string | null } | null;
  if (!reply) return { ok: false, error: "missing" };
  if (reply.undone_at) return { ok: false, error: "already" };

  const { data: evData, error: ee } = await admin.from("venue_data_events").select("*").eq("reply_id", replyId);
  if (ee) throw new Error(ee.message);
  const events = ((evData ?? []) as { id: string; field: string; old_value: unknown; new_value: unknown; undone_at: string | null }[]).filter((e) => !e.undone_at);
  const { data: vData, error: ve } = await admin.from("venues").select("*").eq("venue_key", reply.venue_key).maybeSingle();
  if (ve) throw new Error(ve.message);
  const venue = (vData ?? {}) as Row;

  const patch: Row = {};
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const e of events) {
    if (same(venue[e.field], e.new_value)) {
      patch[e.field] = e.old_value ?? null;
      restored.push(e.field);
    } else skipped.push(e.field);
  }
  if (restored.length > 0) {
    const { error: ue } = await admin.from("venues").update({ ...patch, updated_at: nowIso }).eq("venue_key", reply.venue_key);
    if (ue) throw new Error(ue.message);
  }
  for (const e of events) {
    if (!restored.includes(e.field)) continue;
    const { error: me } = await admin.from("venue_data_events").update({ undone_at: nowIso, undone_by: adminId }).eq("id", e.id);
    if (me) throw new Error(me.message);
  }

  let statusRestored = false;
  const { data: qData } = await admin.from("venue_requests").select("id,status").eq("id", reply.request_id).maybeSingle();
  const req = qData as { id: string; status: string } | null;
  if (req && reply.previous_status && reply.new_status && req.status === reply.new_status && reply.previous_status !== reply.new_status) {
    const { error: se } = await admin.from("venue_requests").update({ status: reply.previous_status }).eq("id", req.id);
    if (se) throw new Error(se.message);
    statusRestored = true;
  }
  const { error: pe } = await admin.from("venue_replies").update({ undone_at: nowIso, undone_by: adminId }).eq("id", replyId);
  if (pe) throw new Error(pe.message);
  return { ok: true, restored, skipped, statusRestored };
}
