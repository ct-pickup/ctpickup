import { NextResponse } from "next/server";
import { getOpenAI, getSupabaseAdmin } from "@/lib/server/runtimeClients";
import {
  jsonApiErrorResponse,
  jsonConfigErrorResponse,
  jsonSupabaseErrorResponse,
  jsonUnexpectedErrorResponse,
  logPublicApiRouteError,
  httpStatusForSupabaseError,
} from "@/lib/server/publicApiRouteErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "pickup/intake";

type Collected = {
  full_name?: string;
  age?: number;
  instagram?: string;
  instagram_norm?: string;
  phone?: string;
  level?: string;
  town?: string;
  position?: string;
  availability?: string;
};

function normalizeInstagram(handle?: string): string | null {
  if (!handle) return null;
  const norm = handle.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
  return norm.length ? norm : null;
}

function distressFlags(s: string) {
  const t = s.toLowerCase();
  const crisis =
    t.includes("suicid") ||
    t.includes("kill myself") ||
    t.includes("end my life") ||
    t.includes("want to die") ||
    t.includes("self harm") ||
    t.includes("self-harm") ||
    t.includes("hurt myself");
  const distress =
    t.includes("depress") ||
    t.includes("depressed") ||
    t.includes("sad") ||
    t.includes("hopeless") ||
    t.includes("can't go on") ||
    t.includes("cant go on");
  return { crisis, distress: distress || crisis };
}

function safetyMessage() {
  return [
    "I’m not a therapist, but I’m sorry you’re feeling that way.",
    "If you’re in immediate danger, call 911.",
    "If you’re in the U.S. and you’re thinking about harming yourself, call or text 988 (Suicide & Crisis Lifeline).",
  ].join(" ");
}

function levelVerdict(level?: string): { ok: boolean; unclear: boolean; reason?: string } {
  const s = (level || "").toLowerCase();
  const reject = [
    "rec",
    "recreational",
    "casual",
    "beginner",
    "low intensity",
    "intramural",
    "men's league",
    "mens league",
    "adult league",
    "just for fun",
    "sunday league",
  ];
  if (reject.some((w) => s.includes(w))) {
    return {
      ok: false,
      unclear: false,
      reason:
        "CT Pickup is intended for college/former college, high-level club (ECNL, MLS Next), and varsity players. If you’re unsure, email pickupct.com and get a referral from a player.",
    };
  }
  const accept = [
    "college",
    "former college",
    "ncaa",
    "d1",
    "d2",
    "d3",
    "juco",
    "naia",
    "mls next",
    "ecnl",
    "varsity",
    "usl",
    "usl2",
    "academy",
    "npsl",
    "semi-pro",
    "semi pro",
    "pro",
  ];
  if (accept.some((w) => s.includes(w))) return { ok: true, unclear: false };
  if (!s.trim()) return { ok: false, unclear: true };
  return { ok: false, unclear: true };
}

function splitFullNameToFirstLast(full: string): { first_name: string | null; last_name: string | null } {
  const s = String(full || "").trim().replace(/\s+/g, " ");
  if (!s) return { first_name: null, last_name: null };
  const parts = s.split(" ");
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function extractAssistantText(resp: any): string | null {
  const helper = (resp?.output_text || "").trim();
  if (helper) return helper;
  const out = Array.isArray(resp?.output) ? resp.output : [];
  const msg = out.find((o: any) => o?.type === "message");
  const content = Array.isArray(msg?.content) ? msg.content : [];
  const text = content.find((c: any) => c?.type === "output_text")?.text;
  return text && String(text).trim() ? String(text).trim() : null;
}

function missingRequired(fields: Collected) {
  const required: (keyof Collected)[] = [
    "full_name",
    "age",
    "instagram",
    "level",
    "phone",
    "town",
    "position",
    "availability",
  ];
  return required.filter((k) => !fields[k]);
}

function nextQuestionForMissing(key: keyof Collected) {
  const q: Record<string, string> = {
    full_name: "What’s your full name?",
    age: "How old are you?",
    instagram: "What’s your Instagram handle? (include @)",
    level: "What’s the highest level you’ve played? (College / Former College / ECNL / MLS Next / Other)",
    phone: "What’s the best phone number for updates?",
    town: "What town are you coming from?",
    position: "What position do you play?",
    availability: "What days/times are you available? Any notes?",
  };
  return q[key] || "What days/times are you available?";
}

function supabaseErrorToStatusAndCode(err: { code?: string; message: string }) {
  const code = (err.code || "").toUpperCase();
  const msg = (err.message || "").toLowerCase();

  // Postgres SQLSTATE codes commonly returned via PostgREST.
  if (code === "42501" || msg.includes("row-level security") || msg.includes("policy")) {
    return { status: 403, error_code: "database_rls_denied" as const };
  }
  if (code === "42P01") return { status: 500, error_code: "database_missing_table" as const };
  if (code === "42703") return { status: 500, error_code: "database_missing_column" as const };
  if (code === "23502") return { status: 400, error_code: "database_null_constraint" as const };
  if (code === "23503") return { status: 400, error_code: "database_foreign_key_violation" as const };
  if (code === "23505") return { status: 409, error_code: "database_duplicate_key" as const };

  return { status: 500, error_code: "database_error" as const };
}

export async function POST(req: Request) {
  let supabase;
  try {
    supabase = getSupabaseAdmin({ auth: { persistSession: false } });
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return jsonApiErrorResponse(ROUTE, "parse_json", {
        status: 400,
        error_code: "invalid_json",
        error: "Something was invalid. Please review and try again.",
        message_safe: true,
      });
    }
    const user_message = String(body?.user_message || "").trim();
    const last_question = String(body?.last_question || "");
    const collected_fields: Collected = body?.collected_fields || {};

    // Debug: print only non-sensitive metadata
    if (process.env.NODE_ENV !== "production") {
      console.log(
        JSON.stringify({
          pickup_intake: true,
          stage: "request_received",
          has_user_message: !!user_message,
          last_question_preview: last_question.slice(0, 80),
          collected_keys: Object.keys(collected_fields || {}),
        }),
      );
    }

    if (!user_message) {
      return jsonApiErrorResponse(ROUTE, "validate_body", {
        status: 400,
        error_code: "bad_request",
        error: "Something was invalid. Please review and try again.",
        message_safe: true,
      });
    }

    const flags = distressFlags(user_message);
    if (flags.crisis) {
      return NextResponse.json({
        done: true,
        crisis: true,
        next_question: safetyMessage(),
        collected_fields,
      });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        done: { type: "boolean" },
        next_question: { type: ["string", "null"] },
        collected_fields: {
          type: "object",
          additionalProperties: false,
          properties: {
            full_name: { type: ["string", "null"] },
            age: { type: ["number", "null"], minimum: 0, maximum: 130 },
            instagram: { type: ["string", "null"] },
            phone: { type: ["string", "null"] },
            level: { type: ["string", "null"] },
            town: { type: ["string", "null"] },
            position: { type: ["string", "null"] },
            availability: { type: ["string", "null"] },
          },
          required: ["full_name", "age", "instagram", "phone", "level", "town", "position", "availability"],
        },
      },
      required: ["done", "next_question", "collected_fields"],
    };

    const openai = getOpenAI();

    const developer = [
      "You are CT Pickup's Pickup Intake assistant.",
      "Ask ONE question at a time and fill collected_fields based on the user's answer.",
      "Required: full_name, age, instagram, level, phone, town, position, availability.",
      "Minimum age is 16. Intended level: college/former college and high-level club (ECNL, MLS Next).",
      "Use last_question to interpret what the user is answering.",
      "Return ONLY strict JSON matching the schema.",
    ].join("\n");

    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: [
        { role: "developer", content: developer },
        { role: "user", content: JSON.stringify({ last_question, collected_fields, user_message }) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pickup_intake",
          strict: true,
          schema,
        },
      },
      store: false,
    });

    const raw = extractAssistantText(resp);
    if (!raw) {
      return jsonApiErrorResponse(ROUTE, "openai_empty_output", {
        status: 500,
        error_code: "model_error",
        error: "Something went wrong on our side. Please try again.",
        message_safe: false,
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          JSON.stringify({
            pickup_intake: true,
            stage: "model_parse_failed",
            raw_preview: raw.slice(0, 300),
          }),
        );
      }
      return jsonApiErrorResponse(ROUTE, "openai_parse_failed", {
        status: 500,
        error_code: "model_error",
        error: "Something went wrong on our side. Please try again.",
        message_safe: false,
      });
    }

    const newFields: Collected = { ...collected_fields, ...(parsed.collected_fields || {}) };

    // cleanup
    for (const k of ["full_name", "instagram", "phone", "level", "town", "position", "availability"] as const) {
      const v = (newFields as any)[k];
      if (typeof v === "string") (newFields as any)[k] = v.trim() || undefined;
    }
    if (typeof newFields.age === "number" && !Number.isFinite(newFields.age)) newFields.age = undefined;

    newFields.instagram_norm = normalizeInstagram(newFields.instagram || undefined) || undefined;

    // Age eligibility
    if (typeof newFields.age === "number" && newFields.age < 16) {
      return NextResponse.json({
        done: true,
        crisis: false,
        next_question: "Not eligible. Minimum age is 16.",
        collected_fields: newFields,
      });
    }

    // Level eligibility
    const verdict = levelVerdict(newFields.level);
    if (!verdict.ok && !verdict.unclear) {
      return NextResponse.json({
        done: true,
        crisis: false,
        next_question: verdict.reason || "Not eligible based on level.",
        collected_fields: newFields,
      });
    }
    if (!verdict.ok && verdict.unclear && newFields.level) {
      const baseNext = "What’s the highest level you’ve played? (College / Former College / ECNL / MLS Next / Other)";
      return NextResponse.json({
        done: false,
        crisis: false,
        next_question: flags.distress ? `${safetyMessage()} To continue: ${baseNext}` : baseNext,
        collected_fields: newFields,
      });
    }

    // Missing required fields
    const missing = missingRequired(newFields);
    if (missing.length) {
      const order: (keyof Collected)[] = [
        "full_name",
        "age",
        "instagram",
        "level",
        "phone",
        "town",
        "position",
        "availability",
      ];
      const firstMissing = order.find((k) => !(newFields as any)[k]) || "availability";
      const baseNext = nextQuestionForMissing(firstMissing);
      return NextResponse.json({
        done: false,
        crisis: false,
        next_question: flags.distress ? `${safetyMessage()} To continue: ${baseNext}` : baseNext,
        collected_fields: newFields,
      });
    }

    if (!newFields.instagram_norm) {
      const baseNext = "What’s your Instagram handle? (include @)";
      return NextResponse.json({
        done: false,
        crisis: false,
        next_question: flags.distress ? `${safetyMessage()} To continue: ${baseNext}` : baseNext,
        collected_fields: newFields,
      });
    }

    const { first_name, last_name } = splitFullNameToFirstLast(newFields.full_name || "");

    const { error: upsertErr } = await supabase.from("pickup_intake_submissions").upsert(
      {
        first_name: first_name || null,
        last_name: last_name || null,
        age: newFields.age ?? null,
        instagram: newFields.instagram ?? null,
        instagram_norm: newFields.instagram_norm ?? null,
        phone: newFields.phone ?? null,
        level: newFields.level ?? null,
        town: newFields.town ?? null,
        position: newFields.position ?? null,
        availability: newFields.availability ?? null,
        meta: {
          source: "pickup_intake_v1",
          intake_full_name: newFields.full_name ?? null,
        },
      },
      { onConflict: "instagram_norm" },
    );

    if (upsertErr) {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          JSON.stringify({
            pickup_intake: true,
            stage: "db_upsert_failed",
            code: upsertErr.code,
            message: upsertErr.message,
          }),
        );
      }
      return jsonSupabaseErrorResponse(
        ROUTE,
        "pickup_intake_submissions.upsert",
        upsertErr,
        httpStatusForSupabaseError(upsertErr),
      );
    }

    return NextResponse.json({
      done: true,
      crisis: false,
      next_question: "Submission received.",
      collected_fields: newFields,
      full_name: [first_name, last_name].filter(Boolean).join(" ").trim() || newFields.full_name || null,
    });
  } catch (e: unknown) {
    logPublicApiRouteError(ROUTE, "unhandled_error", e);
    return jsonUnexpectedErrorResponse(ROUTE, "POST", e);
  }
}

