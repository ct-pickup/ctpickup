/** Profile columns bumped when a host records session awards. */
export type SessionAwardCountField =
  | "potd_count"
  | "goalie_potd_count"
  | "defender_potd_count"
  | "midfielder_potd_count"
  | "attacker_potd_count";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept plain UUID strings or `{ user_id | id | userId }` objects from clients. */
export function asAwardUserId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asAwardUserId(o.user_id ?? o.id ?? o.userId ?? null);
  }
  const s = String(v).trim();
  if (!s || s === "null" || s === "undefined") return null;
  return UUID_RE.test(s) ? s : null;
}

/**
 * Resolve an award winner from a request body, accepting both naming styles
 * (e.g. `player_of_the_day` and `player_of_day`).
 */
export function resolveAwardUserIdFromBody(
  body: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    if (!(key in body)) continue;
    const id = asAwardUserId(body[key]);
    if (id) return id;
  }
  // Also try keys case-insensitively in case clients send camelCase variants.
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(body)) {
    lowerMap.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const id = asAwardUserId(lowerMap.get(key.toLowerCase()));
    if (id) return id;
  }
  return null;
}

export function resolveSessionResultAwards(body: Record<string, unknown>): {
  player_of_day: string | null;
  defender_of_day: string | null;
  midfielder_of_day: string | null;
  attacker_of_day: string | null;
  goalie_of_the_day: string | null;
} {
  return {
    player_of_day: resolveAwardUserIdFromBody(body, "player_of_the_day", "player_of_day", "playerOfTheDay"),
    defender_of_day: resolveAwardUserIdFromBody(
      body,
      "defender_of_the_day",
      "defender_of_day",
      "defenderOfTheDay",
    ),
    midfielder_of_day: resolveAwardUserIdFromBody(
      body,
      "midfielder_of_the_day",
      "midfielder_of_day",
      "midfielderOfTheDay",
    ),
    attacker_of_day: resolveAwardUserIdFromBody(
      body,
      "attacker_of_the_day",
      "attacker_of_day",
      "attackerOfTheDay",
    ),
    goalie_of_the_day: resolveAwardUserIdFromBody(
      body,
      "goalie_of_the_day",
      "goalie_of_day",
      "goalieOfTheDay",
    ),
  };
}
