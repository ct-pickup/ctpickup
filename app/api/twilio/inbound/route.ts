export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got your message — CT Pickup will respond soon.</Message>
</Response>`;

/**
 * Twilio inbound SMS. POST body is application/x-www-form-urlencoded.
 * For production, add signature verification (see `lib/twilio/verifySignature.ts`).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const From = params.get("From") ?? "";
  const Body = params.get("Body") ?? "";
  console.info("[ctpickup twilio inbound]", { From, Body });

  return new Response(TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function GET() {
  return new Response("CT Pickup Twilio inbound route is live", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
