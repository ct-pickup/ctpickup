import { NextResponse } from "next/server";
import { CT_PICKUP_VENUES } from "@/lib/venues/ctPickupVenues";

export const dynamic = "force-dynamic";

const FAR_MINUTES = 45;

type VenueDistanceRow = {
  venue: string;
  address: string;
  estimatedMinutes: number;
};

/** Query string Google can resolve (helps short addresses like "Warwick, NY"). */
function destinationQuery(v: (typeof CT_PICKUP_VENUES)[number]): string {
  return `${v.venue}, ${v.address}`;
}

/** POST body: `{ zip_code }`. Optional header `Authorization: Bearer …` (accepted; not required). */
export async function POST(req: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: "missing_google_maps_api_key" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const zipRaw = typeof body === "object" && body !== null && "zip_code" in body ? String((body as { zip_code?: unknown }).zip_code ?? "") : "";
  const digits = zipRaw.replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) {
    return NextResponse.json({ error: "invalid_zip_code", venues: [] as VenueDistanceRow[] }, { status: 400 });
  }

  const origin = `${digits}, USA`;
  const destinations = CT_PICKUP_VENUES.map(destinationQuery).join("|");

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destinations);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", key);

  let dm: unknown;
  try {
    const r = await fetch(url.toString(), { cache: "no-store" });
    dm = await r.json();
  } catch (e) {
    console.error("[venue/distances] Google request failed:", e);
    return NextResponse.json({ error: "distance_matrix_unavailable" }, { status: 502 });
  }

  if (typeof dm !== "object" || dm === null) {
    return NextResponse.json({ error: "invalid_distance_matrix_response" }, { status: 502 });
  }

  const status = (dm as { status?: unknown }).status;
  if (status !== "OK") {
    const err = (dm as { error_message?: unknown }).error_message;
    console.error("[venue/distances] Google status:", status, err);
    return NextResponse.json(
      { error: "distance_matrix_error", detail: typeof err === "string" ? err : String(status) },
      { status: 502 },
    );
  }

  const rows = (dm as { rows?: unknown }).rows;
  const elements = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? (rows[0] as { elements?: unknown }).elements : null;
  if (!Array.isArray(elements) || elements.length !== CT_PICKUP_VENUES.length) {
    return NextResponse.json({ error: "unexpected_matrix_shape" }, { status: 502 });
  }

  const rowsOut: VenueDistanceRow[] = [];
  for (let i = 0; i < CT_PICKUP_VENUES.length; i++) {
    const v = CT_PICKUP_VENUES[i]!;
    const el = elements[i];
    if (typeof el !== "object" || el === null) continue;
    const elStatus = (el as { status?: unknown }).status;
    if (elStatus !== "OK") continue;
    const dit = (el as { duration_in_traffic?: { value?: unknown } }).duration_in_traffic;
    const duration = (el as { duration?: { value?: unknown } }).duration;
    const sec =
      typeof dit?.value === "number" ? dit.value : typeof duration?.value === "number" ? duration.value : NaN;
    if (!Number.isFinite(sec)) continue;
    const estimatedMinutes = Math.max(1, Math.round(sec / 60));
    rowsOut.push({
      venue: v.venue,
      address: v.address,
      estimatedMinutes,
    });
  }

  rowsOut.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);

  const allFar = rowsOut.length > 0 && rowsOut.every((r) => r.estimatedMinutes >= FAR_MINUTES);
  const picked = allFar ? rowsOut : rowsOut.filter((r) => r.estimatedMinutes < FAR_MINUTES);

  return NextResponse.json({ venues: picked });
}
