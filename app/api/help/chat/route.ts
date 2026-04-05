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

export const runtime = "nodejs";

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
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

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: prompt,
      }),
    });

    const j = await r.json();

    if (!r.ok) {
      return NextResponse.json(
        { error: j?.error?.message || "OpenAI request failed" },
        { status: 500 }
      );
    }

    const rawText =
      j?.output_text ||
      j?.output
        ?.map((item: any) =>
          item?.content?.map((c: any) => c?.text || "").join("")
        )
        .join("\n")
        .trim() ||
      "I couldn’t generate a reply.";

    let { userText, rawActions } = stripNavActionsFromModelText(rawText);
    let actions = sanitizeHelpNavActions(rawActions, { isAdmin, maxActions: 3 });

    if (crisisQuestion) {
      actions = [];
      userText = appendCrisisResourcesIfMissing(userText);
    }

    return NextResponse.json({ text: userText, actions });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
