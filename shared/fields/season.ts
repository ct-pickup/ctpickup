import { START_TIMES, isValidDuration, isValidStartTime, addDaysIso, DEFAULT_DURATION } from "./requestRules";
import { SEASON_MAX_WEEKS } from "./plans";
import { formatRequestWhen } from "./requestEmail";

/** Book my season: one field, the same weekday and time every week for N weeks. Pure rules shared by the app and the server. */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type SeasonInput = {
  venue_key: string;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** "07:00" ... "21:00", on the hour or half hour. */
  start_time: string;
  duration_hours: number;
  weeks: number;
  players: number;
};

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "";
}

/** The first date after `todayEt` that falls on `weekday` (1 to 7 days ahead). */
export function nextWeekdayDate(todayEt: string, weekday: number): string {
  const [y, m, d] = todayEt.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  const ahead = ((weekday - dow + 7) % 7) || 7;
  return addDaysIso(todayEt, ahead);
}

/** Every session date: the start date and then weekly. */
export function seasonDates(startDate: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => addDaysIso(startDate, i * 7));
}

export type SeasonValidation = { ok: true; value: SeasonInput } | { ok: false; error: string };

export function validateSeasonInput(body: Record<string, unknown>): SeasonValidation {
  const venue_key = typeof body.venue_key === "string" ? body.venue_key.trim() : "";
  const weekday = Number(body.weekday);
  const start_time = typeof body.start_time === "string" ? body.start_time.trim().slice(0, 5) : "";
  const duration_hours = body.duration_hours == null ? DEFAULT_DURATION : Number(body.duration_hours);
  const weeks = Number(body.weeks);
  const players = body.players == null ? 14 : Number(body.players);
  if (!venue_key) return { ok: false, error: "Pick a field." };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: "Pick a day of the week." };
  if (!isValidStartTime(start_time) || !START_TIMES.includes(start_time)) return { ok: false, error: "Pick a start time between 7 AM and 9 PM, on the hour or half hour." };
  if (!isValidDuration(duration_hours)) return { ok: false, error: "Pick 1, 1.5 or 2 hours." };
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > SEASON_MAX_WEEKS) return { ok: false, error: `Pick between 1 and ${SEASON_MAX_WEEKS} weeks.` };
  if (!Number.isInteger(players) || players < 1 || players > 100) return { ok: false, error: "Players must be between 1 and 100." };
  return { ok: true, value: { venue_key, weekday, start_time, duration_hours, weeks, players } };
}

/** "every Saturday, 11 AM–1 PM, for 10 weeks starting Sat, Oct 17" */
export function formatSeasonWhen(startDate: string, startTime: string, hours: number, weeks: number): string {
  const first = formatRequestWhen(startDate, startTime, hours); // "Sat, Oct 17, 11 AM–1 PM"
  const [y, m, d] = startDate.split("-").map(Number);
  const day = weekdayName(new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay());
  const timeRange = first.split(", ").slice(2).join(", ");
  const [wd, md] = first.split(", ");
  return `every ${day}, ${timeRange}, for ${weeks} ${weeks === 1 ? "week" : "weeks"} starting ${wd}, ${md}`;
}

/** The email the admin sends to the venue for a season. Holds no player name or contact details. */
export function draftSeasonEmail(i: {
  venueName: string;
  venueKind: "school" | "venue";
  startDate: string;
  startTime: string;
  hours: number;
  weeks: number;
  players: number;
}): { subject: string; body: string } {
  const when = formatSeasonWhen(i.startDate, i.startTime, i.hours, i.weeks);
  const process = i.venueKind === "school" ? "facility-use process" : "booking process";
  return {
    subject: `Season field request: ${i.venueName}, ${when}`,
    body:
      `Hello,\n\n` +
      `A local community soccer group would like to request ${i.venueName} ${when}, about ${i.players} players. ` +
      `Please let us know your ${process}, any fee, any permit we need to fill out, and what insurance you need.\n\n` +
      `Thank you,\nCompetitive Together`,
  };
}
