type Counter = { count: number; resetAtMs: number };

declare global {
  // eslint-disable-next-line no-var
  var __ctpickup_rateLimitCounters: Map<string, Counter> | undefined;
}

function counters(): Map<string, Counter> {
  if (!globalThis.__ctpickup_rateLimitCounters) {
    globalThis.__ctpickup_rateLimitCounters = new Map();
  }
  return globalThis.__ctpickup_rateLimitCounters;
}

export function requestIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for") || "";
  const first = forwardedFor.split(",")[0]?.trim();
  if (first) return first;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

/**
 * Best-effort in-memory rate limit for Node runtime.
 * Note: serverless instances may reset counters between invocations.
 */
export function checkRateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = opts.nowMs ?? Date.now();
  const m = counters();

  const existing = m.get(opts.key);
  if (!existing || existing.resetAtMs <= now) {
    m.set(opts.key, { count: 1, resetAtMs: now + opts.windowMs });
    return { ok: true };
  }

  if (existing.count >= opts.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000));
    return { ok: false, retryAfterSeconds };
  }

  existing.count += 1;
  return { ok: true };
}

