/**
 * Conservative self-harm / suicide-risk signals for help chat safety.
 * False negatives are possible; this is a safety net with the model prompt.
 */

const CRISIS_PATTERNS: RegExp[] = [
  /\bsuicid/i,
  /\bkill\s+myself\b/i,
  /\bkill\s+my\s+self\b/i,
  /\bend\s+(?:my\s+)?life\b/i,
  /\bself[-\s]?harm/i,
  /\bhurt(?:ing)?\s+myself\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bhope\s+i\s+die\b/i,
  /\bnot\s+worth\s+living\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\btake\s+my\s+own\s+life\b/i,
];

export function looksLikeSelfHarmCrisisMessage(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

/** Plain text (help UI is not markdown-rendered). */
export const HELP_CRISIS_RESOURCES_US = `

If you’re in the U.S. and need support right now: call or text 988 (Suicide & Crisis Lifeline, 24/7). For chat and more resources, use the official site: https://988lifeline.org/

If you or someone else is in immediate danger, call 911 or your local emergency number.`;

export function appendCrisisResourcesIfMissing(answer: string): string {
  const t = answer.toLowerCase();
  const has988 = /\b988\b/.test(answer);
  const hasLifeline = /988lifeline\.org/i.test(answer);
  if (has988 && hasLifeline) return answer;
  return answer.trimEnd() + HELP_CRISIS_RESOURCES_US;
}
