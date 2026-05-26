import { DateTime } from "luxon";

const TZ = "America/New_York";

/** Preset availability windows for public pickup runs (Eastern wall clock). */
export const PUBLIC_PICKUP_TIME_SLOT_PRESETS = [
  { label: "10am – 12pm", hour: 10, minute: 0 },
  { label: "3pm – 5pm", hour: 15, minute: 0 },
  { label: "7pm – 10pm", hour: 19, minute: 0 },
] as const;

export type PublicPickupTimeSlotPreset = (typeof PUBLIC_PICKUP_TIME_SLOT_PRESETS)[number];

/** Next calendar day in America/New_York (relative to `now`). */
export function nextEasternCalendarDay(now: DateTime = DateTime.now().setZone(TZ)): {
  year: number;
  month: number;
  day: number;
} {
  const tomorrow = now.plus({ days: 1 });
  return { year: tomorrow.year, month: tomorrow.month, day: tomorrow.day };
}

/** Three labeled slots on the next Eastern calendar day for availability polling. */
export function buildPublicPickupTimeSlotsForNextDay(
  now: DateTime = DateTime.now().setZone(TZ),
): { label: string; start_at: string }[] {
  const { year, month, day } = nextEasternCalendarDay(now);
  return PUBLIC_PICKUP_TIME_SLOT_PRESETS.map((preset) => {
    const dt = DateTime.fromObject(
      { year, month, day, hour: preset.hour, minute: preset.minute, second: 0, millisecond: 0 },
      { zone: TZ },
    );
    const iso = dt.toUTC().toISO();
    if (!iso) {
      throw new RangeError(`Invalid Eastern slot time for ${preset.label}`);
    }
    return { label: preset.label, start_at: iso };
  });
}

/**
 * Placeholder `start_at` for public planning runs: next Eastern calendar day at midnight UTC
 * (date anchor only — poll slots hold real kickoff options until finalize).
 */
export function publicPickupRunPlaceholderStartAt(
  now: DateTime = DateTime.now().setZone(TZ),
): string {
  const { year, month, day } = nextEasternCalendarDay(now);
  const iso = DateTime.utc(year, month, day, 0, 0, 0, 0).toISO();
  if (!iso) {
    throw new RangeError("Invalid placeholder start_at for public pickup run");
  }
  return iso;
}
