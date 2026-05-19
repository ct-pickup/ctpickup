import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { requestIp } from "@/lib/server/rateLimit";

export type PersistentRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window rate limit backed by Supabase (`api_rate_limit_check` RPC).
 * Falls back to allowing the request if the store is unavailable (logged).
 */
export async function checkPersistentRateLimit(opts: {
  route: string;
  ip?: string;
  limit: number;
  windowSeconds: number;
}): Promise<PersistentRateLimitResult> {
  const ip = opts.ip ?? "unknown";
  const bucketKey = `${opts.route}:${ip}`;

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("api_rate_limit_check", {
      p_bucket_key: bucketKey,
      p_limit: opts.limit,
      p_window_seconds: opts.windowSeconds,
    });

    if (error) {
      console.error(
        JSON.stringify({
          tag: "rate-limit",
          message: "persistent_rate_limit_rpc_failed",
          data: { route: opts.route, error: error.message },
        }),
      );
      return { ok: true };
    }

    const row = data as { allowed?: boolean; retry_after_seconds?: number } | null;
    if (row?.allowed === false) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? 60)),
      };
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        tag: "rate-limit",
        message: "persistent_rate_limit_exception",
        data: { route: opts.route, error: msg },
      }),
    );
    return { ok: true };
  }
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return new Response(
    JSON.stringify({ error: "Too many requests. Try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

export async function enforcePersistentRateLimit(
  req: Request,
  opts: { route: string; limit: number; windowSeconds: number },
): Promise<Response | null> {
  const rl = await checkPersistentRateLimit({
    route: opts.route,
    ip: requestIp(req),
    limit: opts.limit,
    windowSeconds: opts.windowSeconds,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSeconds);
  return null;
}
