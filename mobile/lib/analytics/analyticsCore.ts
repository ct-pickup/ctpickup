/**
 * Offline-safe usage events, first party only. Pure logic: storage, network and the clock are passed in so it can be tested.
 *
 * Rules: nothing is recorded unless tracking is switched on (flag on AND the player has not turned usage data off). Events wait in a
 * small queue on the phone, are sent in batches, and are dropped on any permanent failure without telling the player. The queue
 * is capped, so a phone that stays offline never grows without limit. Switching tracking off empties the queue.
 */

export type QueuedEvent = { id: string; name: string; at: number; properties: Record<string, string | number | boolean> };
export type SendResult = { ok: boolean; status: number };

export type AnalyticsDeps = {
  storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
  send: (token: string, body: { session_id: string; platform: string; app_version: string; events: QueuedEvent[] }) => Promise<SendResult>;
  now?: () => number;
  newId?: () => string;
  platform: string;
  appVersion: string;
};

export const QUEUE_KEY = "ct.analytics.queue.v1";
export const MAX_QUEUE = 200;
export const BATCH_SIZE = 25;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const defaultId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 40).padEnd(8, "0");

export function createAnalytics(deps: AnalyticsDeps) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? defaultId;
  const sessionId = newId() + newId();
  let queue: QueuedEvent[] = [];
  let loaded = false;
  let enabled = false;
  let token: string | null = null;
  let busy = false;

  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await deps.storage.getItem(QUEUE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        const fresh = parsed.filter((e): e is QueuedEvent => !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.at === "number" && now() - e.at < MAX_AGE_MS);
        queue = [...fresh, ...queue].slice(-MAX_QUEUE);
      }
    } catch {
      /* unreadable queue: start empty */
    }
  }

  async function persist(): Promise<void> {
    try {
      await deps.storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
      /* storage full or unavailable: the in-memory queue still works */
    }
  }

  return {
    sessionId,
    /** Turn recording on or off and set who is signed in. Off (or signed out) empties the queue everywhere. */
    configure(opts: { enabled: boolean; token: string | null }): void {
      enabled = opts.enabled && !!opts.token;
      token = enabled ? opts.token : null;
      if (!enabled) {
        queue = [];
        void deps.storage.removeItem(QUEUE_KEY).catch(() => undefined);
      }
    },
    isEnabled: () => enabled,
    pending: () => queue.length,
    async track(name: string, properties: Record<string, string | number | boolean> = {}): Promise<void> {
      if (!enabled) return;
      await load();
      queue.push({ id: newId(), name, at: now(), properties });
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      await persist();
    },
    /** Sends what is waiting, one batch at a time. A failure that could heal (offline, 5xx, 429) keeps the events for next time. */
    async flush(): Promise<void> {
      if (!enabled || !token || busy) return;
      await load();
      busy = true;
      try {
        while (enabled && token && queue.length) {
          const batch = queue.slice(0, BATCH_SIZE);
          let res: SendResult;
          try {
            res = await deps.send(token, { session_id: sessionId, platform: deps.platform, app_version: deps.appVersion, events: batch });
          } catch {
            break;
          }
          const retry = !res.ok && (res.status === 0 || res.status === 429 || res.status >= 500);
          if (retry) break;
          // success, or a refusal that will never change (flag off, bad request, opted out): drop the batch
          const sent = new Set(batch.map((e) => e.id));
          queue = queue.filter((e) => !sent.has(e.id));
          await persist();
          if (!res.ok) {
            queue = [];
            await persist();
            break;
          }
        }
      } finally {
        busy = false;
      }
    },
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;
