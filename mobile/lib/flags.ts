import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Remote feature switches, answered by the server (rpc my_flags(): ON for everyone, for the allowlist, and for admins).
 * Fail closed: when the answer cannot be read, every flag is OFF. Failures are not cached, so the next foreground tries again.
 */

export type FlagKey = "fields" | "paid_plans" | "rating_v2" | "rating_results";
export type Flags = Record<FlagKey, boolean>;
export const FLAGS_OFF: Flags = { fields: false, paid_plans: false, rating_v2: false, rating_results: false };

/** Only a literal true turns a flag on. Anything else (missing, "true", 1, null, a bad payload) is OFF. */
export function parseFlags(raw: unknown): Flags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...FLAGS_OFF };
  const o = raw as Record<string, unknown>;
  return { fields: o.fields === true, paid_plans: o.paid_plans === true, rating_v2: o.rating_v2 === true, rating_results: o.rating_results === true };
}

/** Admins are ON for everything (the server says the same); everyone else follows the flag. */
export const flagOn = (flags: Flags, key: FlagKey, isAdmin: boolean): boolean => isAdmin || flags[key] === true;

export const FLAGS_TTL_MS = 60_000;
const READ_TIMEOUT_MS = 8_000;

export type FlagsResult = { flags: Flags; ok: boolean };

export function createFlagsLoader(opts: { ttlMs?: number; now?: () => number; timeoutMs?: number } = {}) {
  const ttl = opts.ttlMs ?? FLAGS_TTL_MS;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  let cached: { userId: string; at: number; flags: Flags } | null = null;

  async function load(supabase: SupabaseClient | null, userId: string | null | undefined, force = false): Promise<FlagsResult> {
    if (!supabase || !userId) return { flags: { ...FLAGS_OFF }, ok: false };
    if (!force && cached && cached.userId === userId && now() - cached.at < ttl) return { flags: cached.flags, ok: true };
    try {
      const read = Promise.resolve(supabase.rpc("my_flags")).then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return parseFlags(data);
      });
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs));
      const flags = await Promise.race([read, timeout]);
      cached = { userId, at: now(), flags };
      return { flags, ok: true };
    } catch {
      return { flags: { ...FLAGS_OFF }, ok: false };
    }
  }
  const clear = () => {
    cached = null;
  };
  return { load, clear };
}

export const flagsLoader = createFlagsLoader();
