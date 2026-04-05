import { NextResponse } from "next/server";
import { getOpenAI, getSupabaseAdmin } from "@/lib/server/runtimeClients";

type Collected = {
  full_name?: string;
  age?: number;
  instagram?: string;
  instagram_norm?: string;
  phone?: string;
  messaging_app?: string; // iMessage / WhatsApp / Other
  level?: string;
  availability?: string;
};

function normalizeInstagram(handle?: string): string | null {
  if (!handle) return null;
  const norm = handle.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
  return norm.length ? norm : null;
}

function distressFlags(s: string) {
  const t = s.toLowerCase();

  // HARD STOP (crisis / self-harm)
  const crisis =
    t.includes("suicid") ||
    t.includes("kill myself") ||
    t.includes("end my life") ||
    t.includes("want to die") ||
    t.includes("self harm") ||
    t.includes("self-harm") ||
    t.includes("hurt myself");

  // SOFT WARNING (distress)
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
    "rec", "recreational", "casual", "beginner", "low intensity",
    "intramural", "men's league", "mens league", "adult league",
    "just for fun", "sunday league"
  ];
  if (reject.some((w) => s.includes(w))) {
    return { ok: false, unclear: false, reason: "CT Pickup tournaments are intended for college/former college, high-level club (ECNL, MLS Next), and varsity players. If you do not meet eligibility, email pickupct.com and get a referral from a player. Most likely you will be able to play. No promises." };
  }

  const accept = [
    "college", "former college", "ncaa", "d1", "d2", "d3", "juco", "naia",
    "mls next", "ecnl", "varsity", "usl", "usl2", "academy", "npsl", "semi-pro", "semi pro", "pro"
  ];
  if (accept.some((w) => s.includes(w))) return { ok: true, unclear: false };

  if (!s.trim()) return { ok: false, unclear: true };
  return { ok: false, unclear: true };
}

function missingRequired(fields: Collected) {
  const required: (keyof Collected)[] = ["full_name", "age", "instagram", "level", "phone", "availability"];
  return required.filter((k) => !fields[k]);
}

function nextQuestionForMissing(key: keyof Collected) {
  const q: Record<string, string> = {
    full_name: "What’s your full name?",
    age: "How old are you?",
    instagram: "What’s your Instagram handle? (include @)",
    level: "What’s the highest level you’ve played? (College / Former College / ECNL / MLS Next / Other)",
    phone: "What’s the best phone number for updates, and do you prefer iMessage or WhatsApp?",
    availability: "What dates/times are you available? Any position or notes?",
  };
  return q[key] || "What’s your availability?";
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const user_message: string = (body?.user_message || "").toString().trim();
    const last_question: string = (body?.last_question || "").toString();
    const collected_fields: Collected = body?.collected_fields || {};

    if (!user_message) return NextResponse.json({ error: "Empty message" }, { status: 400 });

    // HARD STOP BEFORE ANYTHING ELSE
    const flags = distressFlags(user_message);
    if (flags.crisis) {
      return NextResponse.json({
        done: true,
        crisis: true,
        next_question: safetyMessage(),
        collected_fields,
      });
    }

    // Strict schema (nested required must include all keys)
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
            messaging_app: { type: ["string", "null"] },
            level: { type: ["string", "null"] },
            availability: { type: ["string", "null"] },
          },
          required: ["full_name", "age", "instagram", "phone", "messaging_app", "level", "availability"],
        },
      },
      required: ["done", "next_question", "collected_fields"],
    };

    const openai = getOpenAI();

    const developer = [
      "You are CT Pickup's Tournament Intake assistant.",
      "Ask ONE question at a time and fill collected_fields based on the user's answer.",
      "Required: full_name, age, instagram, level, phone, availability.",
      "Optional: messaging_app (iMessage/WhatsApp/Other) — capture it if the user includes it.",
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
          name: "tournament_intake",
          strict: true,
          schema,
        },
      },
      store: false,
    });

    const raw = extractAssistantText(resp);
    if (!raw) return NextResponse.json({ error: "Model output was empty." }, { status: 500 });

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Model output parse error", raw_preview: raw.slice(0, 500) }, { status: 500 });
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
    if (typeof newFields.messaging_app === "string") newFields.messaging_app = newFields.messaging_app.trim() || undefined;

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

    // Missing fields
    const missing = missingRequired(newFields);
    if (missing.length) {
      const order: (keyof Collected)[] = ["full_name", "age", "instagram", "level", "phone", "availability"];
      const firstMissing = order.find((k) => !newFields[k]) || "availability";
      const baseNext = nextQuestionForMissing(firstMissing);

      return NextResponse.json({
        done: false,
        crisis: false,
        next_question: flags.distress ? `${safetyMessage()} To continue: ${baseNext}` : baseNext,
        collected_fields: newFields,
      });
    }

    // Require normalized IG for upsert
    if (!newFields.instagram_norm) {
      const baseNext = "What’s your Instagram handle? (include @)";
      return NextResponse.json({
        done: false,
        crisis: false,
        next_question: flags.distress ? `${safetyMessage()} To continue: ${baseNext}` : baseNext,
        collected_fields: newFields,
      });
    }

    const supabase = getSupabaseAdmin({
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
        meta: { messaging_app: newFields.messaging_app ?? null, source: "tournament_intake_v6" },
      },
      { onConflict: "instagram_norm" }
    );

    return NextResponse.json({
      done: true,
      crisis: false,
      next_question: "Submission received.",
      collected_fields: newFields,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
