import { NextResponse } from "next/server";
import {
  appendCrisisResourcesIfMissing,
  looksLikeSelfHarmCrisisMessage,
} from "@/lib/helpCrisisSignals";
import { getOpenAI } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const MOBILE_HELP_SYSTEM = `You are a helpful assistant for the CT Pickup iOS mobile app. Answer questions about: joining public pickup runs, RSVPing and paying for pickup, in-person outdoor pickup tournaments (Tournaments tab, tournament status, captain claim and team entry, entry fees for field tournaments), the Messages tab (announcements and team chat), the Account screen (profile, waiver, reliability score), and app navigation.

When explaining how to join a pickup run, only describe public runs—the open signup flow players use in the app. Do not describe alternate join paths, priority queues, staffing-only scheduling, or any non-public signup flow.

If the user asks about invites, exclusive pickup, private runs, restricted access, or how they get chosen for special sessions, answer only in this spirit (you may rephrase slightly): “Invites are sent out by the CT Pickup team. Keep an eye on your notifications to know when you've been selected.” Do not add criteria, timing, mechanics, or internal policy beyond that.

Never mention or hint at internal access ordering, ranking bands, invite sequencing, or any behind-the-scenes grouping used to run pickup.

When the user asks about tournaments or how to join a tournament, only explain in-person pickup / field tournaments.

Do NOT give advice about the website, training, coaches, U23, or guidance requests — those are not in the mobile app.

Keep answers short and friendly. If unsure, suggest emailing pickupct@gmail.com.`;

/** Match OpenAI Responses API + SDK shape (see tournament intake route). */
function extractAssistantText(resp: unknown): string | null {
  const r = resp as Record<string, unknown>;
  const helper = String(r?.output_text ?? "").trim();
  if (helper) return helper;

  const out = Array.isArray(r?.output) ? r.output : [];
  const msg = out.find((o: unknown) => (o as { type?: string })?.type === "message");
  const content = Array.isArray((msg as { content?: unknown })?.content)
    ? (msg as { content: unknown[] }).content
    : [];
  const text = content.find((c: unknown) => (c as { type?: string })?.type === "output_text") as
    | { text?: string }
    | undefined;
  const t = text?.text;
  return t && String(t).trim() ? String(t).trim() : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const question = String(body?.question || "").trim();

    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const crisisQuestion = looksLikeSelfHarmCrisisMessage(question);

    let openai;
    try {
      openai = getOpenAI();
    } catch (initErr) {
      console.error("[api/mobile/help] OpenAI client unavailable:", initErr);
      return NextResponse.json(
        { error: "Help assistant is not configured on the server." },
        { status: 503 },
      );
    }

    const prompt = [MOBILE_HELP_SYSTEM, "", `User question: ${question}`].join("\n");

    const model =
      process.env.OPENAI_HELP_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      "gpt-5-mini";

    let resp: unknown;
    try {
      resp = await openai.responses.create({
        model,
        input: prompt,
        max_output_tokens: 2048,
        store: false,
      });
    } catch (apiErr: unknown) {
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.error("[api/mobile/help] OpenAI API request failed:", msg, apiErr);
      return NextResponse.json(
        { error: "The help assistant could not reach the AI service. Try again shortly." },
        { status: 502 },
      );
    }

    const ai = resp as {
      error?: { message?: string; code?: string } | null;
      status?: string;
      incomplete_details?: { reason?: string } | null;
    };

    if (ai.error) {
      console.error("[api/mobile/help] OpenAI response.error:", ai.error);
      return NextResponse.json(
        { error: ai.error.message || "Model returned an error." },
        { status: 502 },
      );
    }

    const extracted = extractAssistantText(resp);
    let userText = extracted?.trim() || "";

    if (
      (ai.status === "failed" || ai.status === "incomplete") &&
      !userText
    ) {
      console.error("[api/mobile/help] OpenAI response not completed:", {
        status: ai.status,
        incomplete_details: ai.incomplete_details,
      });
      return NextResponse.json(
        {
          error:
            ai.incomplete_details?.reason === "max_output_tokens"
              ? "Reply was cut off; ask a shorter question."
              : "The model did not finish a reply. Try again.",
        },
        { status: 502 },
      );
    }

    if (!userText) {
      console.error("[api/mobile/help] Empty model output", {
        responseStatus: ai.status,
      });
      return NextResponse.json(
        { error: "Empty reply from the model. Try again." },
        { status: 502 },
      );
    }

    if (crisisQuestion) {
      userText = appendCrisisResourcesIfMissing(userText);
    }

    return NextResponse.json({ text: userText });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/mobile/help] Unhandled error:", msg, e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
