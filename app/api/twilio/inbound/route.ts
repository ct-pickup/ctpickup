import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio inbound SMS (starter).
 * Twilio POSTs `application/x-www-form-urlencoded` with at least `Body` and `From`.
 * For production, add signature verification (see `lib/twilio/verifySignature.ts`).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const from = params.get("From") ?? "";
  const body = params.get("Body") ?? "";

  console.info("[ctpickup twilio inbound]", { From: from, Body: body });

  const twiml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    "<Response>" +
    "<Message>Got your message — CT Pickup will respond soon.</Message>" +
    "</Response>";

  return new NextResponse(twiml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 });
}
