import { NextResponse } from "next/server";
import { resolveHelpChatUser } from "@/lib/helpChatUser";
import { buildHelpAssistantContext } from "@/lib/helpAssistantContext";
import {
  appendCrisisResourcesIfMissing,
  looksLikeSelfHarmCrisisMessage,
} from "@/lib/helpCrisisSignals";
import { HELP_ASSISTANT_INSTRUCTIONS } from "@/lib/helpAssistantPrompt";
import {
  sanitizeHelpNavActions,
  stripNavActionsFromModelText,
} from "@/lib/helpNavWhitelist";
import { getOpenAI } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

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

    const { isAdmin } = await resolveHelpChatUser(req);
    const adminNavHint = isAdmin
      ? `

SIGNED_IN_USER_IS_STAFF (internal)
This user has staff access. If they ask about managing pickup runs, tournament intake, or the operator status view, you MAY include these in NAV_ACTIONS_JSON (still max 3 total actions): /admin/pickup, /admin/tournament, /admin/status. In your conversational answer, avoid saying “admin”; use neutral wording like “pickup management” or “status tools.”`
      : "";

    let openai;
    try {
      openai = getOpenAI();
    } catch (initErr) {
      console.error("[api/help/chat] OpenAI client unavailable:", initErr);
      return NextResponse.json(
        { error: "Help assistant is not configured on the server." },
        { status: 503 }
      );
    }

    const liveContext = await buildHelpAssistantContext(req);

    const prompt = [
      HELP_ASSISTANT_INSTRUCTIONS + adminNavHint,
      "",
      "---",
      "LIVE CONTEXT (JSON). Prefer these facts for live status, counts, and coaches. Do not treat keys starting with _ as user-facing labels.",
      liveContext,
      "---",
      `User question: ${question}`,
    ].join("\n");

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
      console.error("[api/help/chat] OpenAI API request failed:", msg, apiErr);
      return NextResponse.json(
        { error: "The help assistant could not reach the AI service. Try again shortly." },
        { status: 502 }
      );
    }

    const ai = resp as {
      error?: { message?: string; code?: string } | null;
      status?: string;
      incomplete_details?: { reason?: string } | null;
    };

    if (ai.error) {
      console.error("[api/help/chat] OpenAI response.error:", ai.error);
      return NextResponse.json(
        { error: ai.error.message || "Model returned an error." },
        { status: 502 }
      );
    }

    const extracted = extractAssistantText(resp);
    const rawText = extracted?.trim() || "";

    if (
      (ai.status === "failed" || ai.status === "incomplete") &&
      !rawText
    ) {
      console.error("[api/help/chat] OpenAI response not completed:", {
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
        { status: 502 }
      );
    }

    if (!rawText) {
      console.error("[api/help/chat] Empty model output", {
        responseStatus: ai.status,
      });
      return NextResponse.json(
        { error: "Empty reply from the model. Try again." },
        { status: 502 }
      );
    }

    const { userText: parsedUserText, rawActions } =
      stripNavActionsFromModelText(rawText);
    let userText = parsedUserText;
    let actions = sanitizeHelpNavActions(rawActions, { isAdmin, maxActions: 3 });

    if (crisisQuestion) {
      actions = [];
      userText = appendCrisisResourcesIfMissing(userText);
    }

    return NextResponse.json({ text: userText, actions });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/help/chat] Unhandled error:", msg, e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
