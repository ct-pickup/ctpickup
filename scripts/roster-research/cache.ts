import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { atomicWriteFileSync } from "./disk.ts";

/**
 * The page cache. Every entry is one gzip-compressed JSON file, <cacheDir>/<host>/<sha1 of url>.json.gz, holding
 * {url, status, body, fetchedAt}. HTML bodies are stripped of everything the parsers never read before they are saved.
 * Older caches wrote uncompressed <sha1>.json files; those are still read, and --prune-cache compacts them.
 */

export type CacheEntry = { url: string; status: number; body: string; fetchedAt?: string };

/**
 * Removes what no parser reads: the <head> (scripts, styles, meta), scripts, styles, inline SVG, <noscript>, comments, inline style
 * attributes, and base64 data: URIs. Markup, class names, links and text are kept exactly. Collapses runs of spaces.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head(?:\s[^>]*)?>[\s\S]*?<\/head\s*>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, "")
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\b(src|srcset|href|poster|data-src|data-srcset|data-bg|data-background-image)\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi, '$1=""')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");
}

/** True for an HTML page (as opposed to a JSON API answer or robots.txt). */
export const looksLikeHtml = (body: string): boolean => /^\s*<(?:!doctype|html|head|body|div|ul|table|section|main)/i.test(body) || /<html[\s>]/i.test(body.slice(0, 2000));

export const prepareBody = (body: string): string => (looksLikeHtml(body) ? stripHtml(body) : body);

export const cacheKey = (url: string): string => createHash("sha1").update(url).digest("hex");

export function cacheFiles(cacheDir: string, url: string): { gz: string; legacy: string } {
  const dir = join(cacheDir, new URL(url).hostname);
  const k = cacheKey(url);
  return { gz: join(dir, `${k}.json.gz`), legacy: join(dir, `${k}.json`) };
}

/** Reads one cache file, .json.gz or older .json. A damaged file (for example one cut short by a full disk) reads as null. */
export function readCacheFile(file: string): CacheEntry | null {
  try {
    const raw = readFileSync(file);
    const text = file.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    const c = JSON.parse(text) as CacheEntry;
    return typeof c.status === "number" && typeof c.body === "string" ? c : null;
  } catch {
    return null;
  }
}

export function readCacheEntry(cacheDir: string, url: string): CacheEntry | null {
  const f = cacheFiles(cacheDir, url);
  if (existsSync(f.gz)) {
    const c = readCacheFile(f.gz);
    if (c) return c;
    try {
      unlinkSync(f.gz); // damaged: forget it, the page is fetched again
    } catch {
      /* already gone */
    }
  }
  return existsSync(f.legacy) ? readCacheFile(f.legacy) : null;
}

/** Strips HTML, gzips and writes atomically. Returns the bytes written. */
export function writeCacheEntry(cacheDir: string, e: CacheEntry): number {
  const f = cacheFiles(cacheDir, e.url);
  mkdirSync(join(f.gz, ".."), { recursive: true });
  const data = gzipSync(JSON.stringify({ ...e, body: prepareBody(e.body) }));
  atomicWriteFileSync(f.gz, data);
  return data.length;
}

export function cacheSize(cacheDir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else {
        bytes += statSync(p).size;
        files++;
      }
    }
  };
  walk(cacheDir);
  return { bytes, files };
}

export const formatMb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

export type PruneInput = {
  cacheDir: string;
  /** Pages the progress file says are finished (status ok or missing): their URLs. */
  parsedUrls: string[];
  /** Schools whose platform is already stored: their home page is not needed any more. */
  homeUrls: string[];
};
export type PruneResult = { deletedPages: number; deletedHomePages: number; compacted: number; freedBytes: number };

const unlinkSize = (f: string): number => {
  try {
    const n = statSync(f).size;
    unlinkSync(f);
    return n;
  } catch {
    return 0;
  }
};

/**
 * Deletes cached HTML that is no longer needed: pages the progress file says are parsed, and school home pages whose platform is
 * stored. Then compacts what remains of the older uncompressed cache into stripped .json.gz files. robots.txt and API answers
 * are small and kept. Never touches the progress file, the school lists or the CSVs.
 */
export function pruneCache(i: PruneInput): PruneResult {
  const r: PruneResult = { deletedPages: 0, deletedHomePages: 0, compacted: 0, freedBytes: 0 };
  const drop = (url: string, kind: "deletedPages" | "deletedHomePages") => {
    let f: ReturnType<typeof cacheFiles>;
    try {
      f = cacheFiles(i.cacheDir, url);
    } catch {
      return;
    }
    let n = 0;
    for (const file of [f.gz, f.legacy]) if (existsSync(file)) n += unlinkSize(file);
    if (n > 0) {
      r[kind]++;
      r.freedBytes += n;
    }
  };
  for (const u of i.parsedUrls) drop(u, "deletedPages");
  for (const u of i.homeUrls) drop(u, "deletedHomePages");

  // Compact the older uncompressed entries that are still wanted.
  if (existsSync(i.cacheDir)) {
    for (const host of readdirSync(i.cacheDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = join(i.cacheDir, host.name);
      for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const legacy = join(dir, name);
        const before = statSync(legacy).size;
        const c = readCacheFile(legacy);
        if (!c) {
          r.freedBytes += unlinkSize(legacy); // unreadable: drop it
          continue;
        }
        const written = writeCacheEntry(i.cacheDir, c);
        unlinkSync(legacy);
        r.compacted++;
        r.freedBytes += before - written;
      }
    }
  }
  return r;
}
