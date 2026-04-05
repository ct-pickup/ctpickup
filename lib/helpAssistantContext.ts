import { createClient } from "@supabase/supabase-js";
import { requestSiteUrlFromRequest } from "@/lib/requestSiteUrl";
import { TRAINING_REQUEST_LINK, trainingCoaches } from "@/lib/trainingCoaches";

const HELP_CONTEXT_OMIT_KEYS = new Set(["attendees", "is_admin"]);

/** Remove PII and fields that invite admin-related talk in help replies. */
function redactHelpContextTree(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactHelpContextTree);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (HELP_CONTEXT_OMIT_KEYS.has(k)) continue;
    out[k] = redactHelpContextTree(v);
  }
  return out;
}

export async function buildHelpAssistantContext(req: Request): Promise<string> {
  const base = requestSiteUrlFromRequest(req);
  const auth = req.headers.get("authorization");
  const noStore = { cache: "no-store" as RequestCache };

  const pickupInit: RequestInit = {
    ...noStore,
    headers: auth ? { Authorization: auth } : undefined,
  };

  const [tournamentRes, summaryRes, pickupRes] = await Promise.all([
    fetch(`${base}/api/tournament/public`, noStore),
    fetch(`${base}/api/status/summary`, noStore),
    fetch(`${base}/api/pickup/public`, pickupInit),
  ]);

  let tournament_public: unknown = null;
  try {
    tournament_public = await tournamentRes.json();
  } catch {
    tournament_public = null;
  }
  if (!tournamentRes.ok) {
    tournament_public = {
      _error: "tournament_public_unavailable",
      status: tournamentRes.status,
      body: tournament_public,
    };
  }

  let api_status_summary: unknown = null;
  try {
    api_status_summary = summaryRes.ok ? await summaryRes.json() : null;
  } catch {
    api_status_summary = null;
  }

  let pickup_public: unknown = null;
  try {
    pickup_public = await pickupRes.json();
  } catch {
    pickup_public = null;
  }
  if (!pickupRes.ok) {
    pickup_public = {
      _error: "pickup_public_unavailable",
      status: pickupRes.status,
      body: pickup_public,
    };
  }

  let status_updates_row_1: unknown = null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const supabaseService = createClient(url, key, { auth: { persistSession: false } });
      const { data } = await supabaseService
        .from("status_updates")
        .select("phase,primary_slot,secondary_slot,next_update_by,announcement")
        .eq("id", 1)
        .maybeSingle();
      status_updates_row_1 = data;
    } catch {
      status_updates_row_1 = null;
    }
  }

  const training_coaches = trainingCoaches.map((c) => ({
    name: c.name,
    slug: c.slug,
    position: c.position,
    cardSpecialty: c.cardSpecialty,
    specialty: c.specialty,
    bookingLink: c.bookingLink,
  }));

  const payload = redactHelpContextTree({
    fetchedAt: new Date().toISOString(),
    api_status_summary,
    tournament_public,
    pickup_public,
    status_updates_row_1,
    training_coaches,
    training_request_link: TRAINING_REQUEST_LINK,
  });

  return JSON.stringify(payload, null, 2);
}
