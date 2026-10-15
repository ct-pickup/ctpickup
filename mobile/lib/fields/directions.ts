/**
 * The link for "Get directions": Apple Maps on iOS, Google Maps on Android, using the field's coordinates (and its name on Apple Maps
 * so the destination is labelled). Null when the field has no location.
 */
export function directionsUrl(os: "ios" | "android" | string, lat: number | null | undefined, lon: number | null | undefined, name: string): string | null {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ll = `${lat},${lon}`;
  if (os === "ios") return `http://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(name)}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
}
