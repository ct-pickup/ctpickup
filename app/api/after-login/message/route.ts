import { NextResponse } from "next/server";
import { getOpenAI } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  try {
    const openai = getOpenAI();

    const body = await req.json();
    const tournamentStatus = String(body?.tournamentStatus || "planning");

    const prompt = `
Write exactly TWO lines. No emojis. No extra text.

Line 1 must be ONE of:
- "Tournament is in the planning phase."
- "Tournament has been confirmed."

Line 2 must be:
- "Would you be willing to play?"

Tournament status is: ${tournamentStatus}
If status is "confirmed", use the confirmed line. Otherwise use planning.
`.trim();

    const r = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      max_output_tokens: 80,
    });

    const raw = String((r as any).output_text || "").trim();
    const lines = raw.split("\n").map((x) => x.trim()).filter(Boolean);

    const line1 =
      tournamentStatus === "confirmed"
        ? "Tournament has been confirmed."
        : "Tournament is in the planning phase.";
    const line2 = "Would you be willing to play?";

    const out =
      lines.length >= 2 ? `${lines[0]}\n${lines[1]}` : `${line1}\n${line2}`;

    return NextResponse.json({ text: out });
  } catch {
    return NextResponse.json({
      text: "Tournament is in the planning phase.\nWould you be willing to play?",
    });
  }
}
