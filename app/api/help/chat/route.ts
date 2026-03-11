import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const question = String(body?.question || "").trim();

    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const prompt = [
      "You are the assistant for the CT Pickup soccer platform.",
      "Help users navigate the site clearly and briefly.",
      "Useful routes:",
      "- /pickup = pickup games",
      "- /tournament = tournaments",
      "- /training = training",
      "- /u23 = select team / U23",
      "- /info = about / general info",
      "- /rules = rules",
      "",
      "If the user asks how to do something, give short numbered steps.",
      "If you are unsure, say so briefly and point them to the closest page.",
      "",
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

    const text =
      j?.output_text ||
      j?.output
        ?.map((item: any) =>
          item?.content?.map((c: any) => c?.text || "").join("")
        )
        .join("\n")
        .trim() ||
      "I couldn’t generate a reply.";

    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}

