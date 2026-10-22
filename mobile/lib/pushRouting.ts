import type { Href } from "expo-router";

/**
 * Where a tapped push opens, from the `data` the server attached. Null means "do nothing" (the app just opens).
 * Only the field-request pushes are routed so far; other pushes keep their current behavior.
 *   - A player's "request update" push (screen "field-requests") opens that request in My requests.
 *   - An admin's "new field request" push (screen "admin/field-requests") opens the admin queue, for admins only.
 */
export function routeForPushData(data: unknown, ctx: { isAdmin: boolean }): Href | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { screen?: unknown; request_id?: unknown };
  const request = typeof d.request_id === "string" && /^[0-9a-f-]{36}$/i.test(d.request_id) ? d.request_id : null;
  if (d.screen === "field-requests") {
    return (request ? `/field-requests?request=${request}` : "/field-requests") as Href;
  }
  if (d.screen === "admin/field-requests") {
    return ctx.isAdmin ? ("/admin/field-requests" as Href) : null;
  }
  return null;
}
