/** Same support inbox the rest of the app uses (see /lib/supportEmail.ts at the repo root). */
const REPORT_EMAIL = "pickupct@gmail.com";

export function reportFieldIssueUrl(venueName: string, venueKey: string): string {
  const subject = encodeURIComponent(`Wrong info: ${venueName}`);
  const body = encodeURIComponent(`Venue: ${venueName} (${venueKey})\n\nWhat is wrong with the price or permit info?\n`);
  return `mailto:${REPORT_EMAIL}?subject=${subject}&body=${body}`;
}
