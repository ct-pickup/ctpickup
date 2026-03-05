import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Collected = {
  full_name?: string;
  age?: number;
  instagram?: string;
  instagram_norm?: string;
  phone?: string;
  level?: string;
  availability?: string;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeInstagram(handle?: string): string | null {
  if (!handle) return null;
  const norm = handle.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
  return norm.length ? norm : null;
}

function levelVerdict(level?: string): { ok: boolean; unclear: boolean; reason?: string } {
  const s = (level || "").toLowerCase();

  const reject = [
    "rec", "recreational", "casual", "beginner", "low intensity",
    "intramural", "men's league", "mens league", "adult league",
    "just for fun", "sunday league"
  ];
  if (reject.some((w) => s.includes(w))) {
    return { ok: false, unclear: false, reason: "CT Pickup tournaments are intended for college/former college and high-level club players (ECNL, MLS Next)." };
  }

  const accept = [
    "college", "former college", "ncaa", "d1", "d2", "d3", "juco", "naia",
    "mls next", "ecnl", "usl", "usl2", "academy", "npsl", "semi-pro", "semi pro", "pro"
  ];
  if (accept.some((w) => s.includes(w))) return { ok: true, unclear: false };

  if (!s.trim()) return { ok: false, unclear: true };
  return { ok: false, unclear: true };
}

function missingRequired(fields: Collected) {
  const required: (keyof Collected)[] = ["full_name", "age", "instagram", "level", "phone", "availability"];
  return required.filter((k) => !fields[k]);
}

// Extract output_text (or refusal) from Responses output array
function extractAssistantTextOrRefusal(resp: any): { text?: string; refusal?: string; debug: any } {
  const debug = {
    id: resp?.id,
    status: resp?.status,
    output_types: Array.isArray(resp?.output) ? resp.output.map((o: any) => o?.type) : [],
  };

  // SDK helper (if present)
  const helperText = (resp?.output_text || "").trim();
  if (helperText) return { text: helperText, debug };

  // Look for message -> output_text / refusal
  const out = Array.isArray(resp?.output) ? resp.output : [];
  const msg = out.find((o: any) => o?.type === "message");
  const content = Array.isArray(msg?.content) ? msg.content : [];

  const refusal = content.find((c: any) => c?.type === "refusal")?.refusal;
  if (refusal) return { refusal: String(refusal), debug };

  const text = content.find((c: any) => c?.type === "output_text")?.text;
  if (text && String(text).trim()) return { text: String(text).trim(), debug };

  return { debug };
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !supabaseServiceKey) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });

    const body = await req.json();
    const user_message: string = (body?.user_message || "").toString().trim();
    const last_question: string = (body?.last_question || "").toString();
    const collected_fields: Collected = body?.collected_fields || {};

    if (!user_message) return NextResponse.json({ error: "Empty message" }, { status: 400 });

    // STRICT schema rules: nested objects must have required that includes ALL keys. :contentReference[oaicite:1]{index=1}
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
            availability: { type: ["string", "null"] },
          },
          required: ["full_name", "age", "instagram", "phone", "level", "availability"],
        },
      },
      required: ["done", "next_question", "collected_fields"],
    };

    const developer = [
      "You are CT Pickup's Tournament Intake assistant.",
      "Ask ONE question at a time and fill collected_fields based on the user's answer.",
      "Required: full_name, age, instagram, level, phone, availability.",
      "Minimum age is 16. Intended level: college/former college and high-level club (ECNL, MLS Next).",
      "Use last_question to interpret what the user is answering.",
      "Return ONLY strict JSON matching the schema.",
    ].join("\n");

    const userPrompt = JSON.stringify(
      {
        last_question,
        collected_fields,
        user_message,
      },
      null,
      0
    );

    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: [
        { role: "developer", content: developer },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "tournament_intake",
          strict: true,
          schema,
        },
      },
      store: false,
    });

    const extracted = extractAssistantTextOrRefusal(resp);

    if (extracted.refusal) {
      return NextResponse.json({ error: "Model refused.", refusal: extracted.refusal }, { status: 500 });
    }
    if (!extracted.text) {
      return NextResponse.json(
        { error: "Model output was empty.", debug: extracted.debug },
        { status: 500 }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(extracted.text);
    } catch {
      // last-resort: extract {...}
      const t = extracted.text;
      const a = t.indexOf("{");
      const b = t.lastIndexOf("}");
      if (a !== -1 && b !== -1 && b > a) {
        parsed = JSON.parse(t.slice(a, b + 1));
      } else {
        return NextResponse.json({ error: "Model output parse error", raw_preview: t.slice(0, 500) }, { status: 500 });
      }
    }

    const newFields: Collected = {
      ...collected_fields,
      ...(parsed.collected_fields || {}),
    };

    // cleanup
    if (typeof newFields.full_name === "string") newFields.full_name = newFields.full_name.trim() || undefined;
    if (typeof newFields.instagram === "string") newFields.instagram = newFields.instagram.trim() || undefined;
    if (typeof newFields.level === "string") newFields.level = newFields.level.trim() || undefined;
    if (typeof newFields.phone === "string") newFields.phone = newFields.phone.trim() || undefined;
    if (typeof newFields.availability === "string") newFields.availability = newFields.availability.trim() || undefined;

    newFields.instagram_norm = normalizeInstagram(newFields.instagram || undefined) || undefined;

    // Eligibility: age
    if (typeof newFields.age === "number" && newFields.age < 16) {
      return NextResponse.json({
        done: true,
        next_question: "Not eligible. Minimum age is 16.",
        collected_fields: newFields,
      });
    }

    // Eligibility: level
    const verdict = levelVerdict(newFields.level);
    if (!verdict.ok && !verdict.unclear) {
      return NextResponse.json({
        done: true,
        next_question: verdict.reason || "Not eligible based on level.",
        collected_fields: newFields,
      });
    }
    if (!verdict.ok && verdict.unclear && newFields.level) {
      return NextResponse.json({
        done: false,
        next_question: "What’s your highest level played? (College / Former College / ECNL / MLS Next / Other)",
        collected_fields: newFields,
      });
    }

    // Missing fields -> ask deterministic next question
    const missing = missingRequired(newFields);
    if (missing.length) {
      const order: (keyof Collected)[] = ["full_name", "age", "instagram", "level", "phone", "availability"];
      const firstMissing = order.find((k) => !newFields[k]) || "availability";
      const questions: Record<string, string> = {
        full_name: "What’s your full name?",
        age: "How old are you?",
        instagram: "What’s your Instagram handle? (include @)",
        level: "What’s your highest level played? (College / Former College / ECNL / MLS Next / Other)",
        phone: "What’s the best phone number for day-of updates?",
        availability: "What dates/times are you available? Any position or notes?",
      };

      return NextResponse.json({
        done: false,
        next_question: questions[firstMissing],
        collected_fields: newFields,
      });
    }

    // Upsert by instagram_norm
    if (!newFields.instagram_norm) {
      return NextResponse.json({
        done: false,
        next_question: "What’s your Instagram handle? (include @)",
        collected_fields: newFields,
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    await supabase.from("tourney_submissions").upsert(
      {
        full_name: newFields.full_name ?? null,
        age: newFields.age ?? null,
        instagram: newFields.instagram ?? null,
        instagram_norm: newFields.instagram_norm ?? null,
        phone: newFields.phone ?? null,
        level: newFields.level ?? null,
        availability: newFields.availability ?? null,
        decision: "pending",
        reviewed: false,
        meta: { source: "tournament_intake_v4" },
      },
      { onConflict: "instagram_norm" }
    );

    return NextResponse.json({
      done: true,
      next_question: "Submitted. We’ll follow up with next steps.",
      collected_fields: newFields,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
