/**
 * Minimal iCalendar (.ics) reader for venue calendars. Pure: no network, no app imports.
 *
 * It reads single (non-recurring) events. A calendar that uses recurrence (RRULE / RDATE) is reported as unsupported,
 * because skipping those events would make a booked hour look free. The caller then leaves the venue as Unknown.
 */

export type IcsEvent = { uid: string | null; summary: string | null; start: Date; end: Date };
export type IcsResult = { events: IcsEvent[]; recurring: number; skipped: number };

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/** Instant for a wall-clock time in an IANA zone, found by correcting a UTC guess with the zone's offset. */
export function zonedToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date | null {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const offsetAt = (ms: number) => {
      const p = fmt.formatToParts(new Date(ms));
      const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
      return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - ms;
    };
    let ms = utcGuess - offsetAt(utcGuess);
    ms = utcGuess - offsetAt(ms);
    return new Date(ms);
  } catch {
    return null;
  }
}

type Prop = { name: string; params: Record<string, string>; value: string };

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: head[0]!.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** `20261017T100000Z`, `20261017T100000` (with TZID or floating) or `20261017` (all day). Floating times are treated as Eastern. */
function parseDate(p: Prop, defaultTz: string): { date: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) {
    const day = zonedToDate(y, mo, d, 0, 0, 0, defaultTz);
    return day ? { date: day, allDay: true } : null;
  }
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  const date = zonedToDate(y, mo, d, h, mi, s, p.params.TZID || defaultTz);
  return date ? { date, allDay: false } : null;
}

function parseDuration(v: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 7 + Number(m[2] ?? 0)) * 86400 + Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0)) * 1000;
}

export function parseIcs(text: string, defaultTz = "America/New_York"): IcsResult {
  const lines = unfold(text);
  const result: IcsResult = { events: [], recurring: 0, skipped: 0 };
  let cur: Prop[] | null = null;
  for (const line of lines) {
    const up = line.trim().toUpperCase();
    if (up === "BEGIN:VEVENT") {
      cur = [];
      continue;
    }
    if (up === "END:VEVENT") {
      if (cur) {
        const get = (n: string) => cur!.find((p) => p.name === n);
        const status = get("STATUS")?.value.trim().toUpperCase();
        if (get("RRULE") || get("RDATE")) {
          result.recurring += 1;
        } else if (status === "CANCELLED") {
          result.skipped += 1;
        } else {
          const ds = get("DTSTART");
          const de = get("DTEND");
          const dur = get("DURATION");
          const start = ds ? parseDate(ds, defaultTz) : null;
          let end: Date | null = null;
          if (start && de) end = parseDate(de, defaultTz)?.date ?? null;
          else if (start && dur) {
            const ms = parseDuration(dur.value);
            end = ms == null ? null : new Date(start.date.getTime() + ms);
          } else if (start) end = new Date(start.date.getTime() + (start.allDay ? 86400000 : 0));
          if (start && end && end > start.date) {
            result.events.push({ uid: get("UID")?.value.trim() ?? null, summary: get("SUMMARY") ? unescapeText(get("SUMMARY")!.value) || null : null, start: start.date, end });
          } else result.skipped += 1;
        }
      }
      cur = null;
      continue;
    }
    if (cur) {
      const prop = parseLine(line);
      if (prop) cur.push(prop);
    }
  }
  return result;
}

/** "webcal://" links are https calendars. Anything but https is rejected. */
export function normalizeCalendarUrl(input: string): string | null {
  const t = input.trim().replace(/^webcal:\/\//i, "https://");
  try {
    const u = new URL(t);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "google" for Google Calendar links, otherwise a generic iCal feed. */
export function guessProvider(url: string): "google" | "ical" {
  return /calendar\.google\.com/i.test(url) ? "google" : "ical";
}
