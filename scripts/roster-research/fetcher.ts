import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A polite fetcher for public web pages: identifies itself, honours robots.txt, waits at least a second between requests to the
 * same host, and caches every response (including 404s) on disk so nothing is ever fetched twice. Network is injected for tests.
 */

export type FetchResponse = { status: number; text(): Promise<string> };
export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: "follow"; signal?: AbortSignal }) => Promise<FetchResponse>;

export type FetchResult = { url: string; status: number; body: string; fromCache: boolean; error?: string; blockedByRobots?: boolean };

export function buildUserAgent(contactEmail: string | undefined): string {
  const e = (contactEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Set ROSTER_CONTACT_EMAIL to a real contact email: it goes in the User-Agent so site owners can reach you.");
  return `CTPickupRosterResearch/1.0 (public roster pages only, 1 request/second per host; contact: ${e})`;
}

/** Disallow / Allow rules for our agent (or *), longest match wins, Allow wins ties. */
export function robotsAllows(robotsTxt: string, path: string, agent = "CTPickupRosterResearch"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const lineRaw of robotsTxt.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2]!.trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (k === "allow" || k === "disallow") && v) cur.rules.push({ allow: k === "allow", path: v });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of use)
    for (const r of g.rules) {
      const pat = r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
      if (new RegExp(`^${pat}`).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
  return best ? best.allow : true;
}

export type FetcherOptions = {
  cacheDir: string;
  userAgent: string;
  minIntervalMs?: number;
  /** Slower hosts: milliseconds between requests per host. The Wayback Machine gets 2 seconds by default. */
  hostIntervalMs?: Record<string, number>;
  /** Give up on a request after this long (default 30 seconds). A timeout is a retryable network error, not cached. */
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Cache only: never touch the network. A page that is not cached comes back as an error. For re-parsing what is already collected. */
  offline?: boolean;
};

export class PoliteFetcher {
  private last = new Map<string, number>();
  /** One request at a time per host, so two workers can never both pass the "wait a second" check together. */
  private lanes = new Map<string, Promise<unknown>>();
  private robots = new Map<string, string | null>();
  readonly requests: string[] = [];
  private o: Required<FetcherOptions>;

  constructor(o: FetcherOptions) {
    this.o = {
      minIntervalMs: 1000,
      hostIntervalMs: { "web.archive.org": 2000 },
      timeoutMs: 30_000,
      offline: false,
      fetchImpl: ((url, init) => fetch(url, init)) as FetchLike,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      ...o,
    };
  }

  private cachePath(url: string): string {
    const host = new URL(url).hostname;
    const dir = join(this.o.cacheDir, host);
    mkdirSync(dir, { recursive: true });
    return join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
  }

  private async throttle(host: string): Promise<void> {
    const interval = this.o.hostIntervalMs[host] ?? this.o.minIntervalMs;
    const wait = (this.last.get(host) ?? 0) + interval - this.o.now();
    if (wait > 0) await this.o.sleep(wait);
    this.last.set(host, this.o.now());
  }

  private async raw(url: string): Promise<FetchResult> {
    const file = this.cachePath(url);
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8")) as { status: number; body: string };
      return { url, status: c.status, body: c.body, fromCache: true };
    }
    if (this.o.offline) return { url, status: 0, body: "", fromCache: false, error: "offline: not in the cache" };
    const host = new URL(url).hostname;
    const run = async (): Promise<FetchResult> => {
      // Another worker may have fetched this exact page while this one waited its turn.
      if (existsSync(file)) {
        const c = JSON.parse(readFileSync(file, "utf8")) as { status: number; body: string };
        return { url, status: c.status, body: c.body, fromCache: true };
      }
      await this.throttle(host);
      this.requests.push(url);
      try {
        const res = await this.o.fetchImpl(url, {
          headers: { "User-Agent": this.o.userAgent, Accept: "text/html,*/*;q=0.5" },
          redirect: "follow",
          signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(this.o.timeoutMs) : undefined,
        });
        const body = await res.text();
        // Cache what the site answered, even a 404, so it is not asked twice. Server errors and rate limits are retried later.
        if (res.status < 500 && res.status !== 429) writeFileSync(file, JSON.stringify({ url, status: res.status, body, fetchedAt: new Date(this.o.now()).toISOString() }));
        return { url, status: res.status, body, fromCache: false };
      } catch (e) {
        const name = (e as { name?: string })?.name;
        return { url, status: 0, body: "", fromCache: false, error: name === "TimeoutError" || name === "AbortError" ? `timeout after ${this.o.timeoutMs / 1000}s` : e instanceof Error ? e.message : "network error" };
      }
    };
    const prev = this.lanes.get(host) ?? Promise.resolve();
    const mine = prev.then(run, run);
    this.lanes.set(host, mine.catch(() => undefined));
    return mine;
  }

  private async robotsFor(url: string): Promise<string | null> {
    const u = new URL(url);
    const key = u.origin;
    if (!this.robots.has(key)) {
      const r = await this.raw(`${u.origin}/robots.txt`);
      // A network error reading robots.txt is not remembered: the host is tried again next time instead of being blocked for the run.
      if (r.status === 200) this.robots.set(key, r.body);
      else if (r.status === 404 || r.status === 403) this.robots.set(key, "");
      else return null;
    }
    return this.robots.get(key) ?? null;
  }

  async get(url: string): Promise<FetchResult> {
    // Offline re-parsing only reads pages that were already fetched under robots.txt, so it needs no robots check.
    if (this.o.offline) return this.raw(url);
    const robots = await this.robotsFor(url);
    if (robots === null) return { url, status: 0, body: "", fromCache: false, error: "could not read robots.txt" };
    const u = new URL(url);
    if (!robotsAllows(robots, u.pathname + u.search)) return { url, status: 0, body: "", fromCache: false, blockedByRobots: true, error: "disallowed by robots.txt" };
    return this.raw(url);
  }
}

/** A Wayback Machine URL for the snapshot nearest the middle of that fall season. */
export function waybackUrl(season: number, url: string): string {
  return `https://web.archive.org/web/${season}1001/${url}`;
}
