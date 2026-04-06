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

/**
 * Hard-stop crisis response for the in-app help assistant.
 *
 * Requirements:
 * - No follow-up questions.
 * - Immediate crisis resources + emergency guidance + next steps.
 * - Plain text (help UI is not markdown-rendered).
 */
export const HELP_CRISIS_RESPONSE_US = `I’m really sorry you’re feeling this way, and I’m glad you reached out. You don’t have to go through this alone.

If you’re in the U.S., call or text 988 (Suicide & Crisis Lifeline, 24/7). For chat and more resources, use the official site: https://988lifeline.org/

If you’re in immediate danger, call 911 (U.S.) or your local emergency number right now.

Immediate next steps:
- Call or text 988 now.
- Reach out to someone you trust (a friend, family member, teammate) and stay with them or ask them to stay on the phone with you.
- If you can, move to a safer place and put distance between you and anything you could use to hurt yourself.`;

export function appendCrisisResourcesIfMissing(answer: string): string {
  const t = answer.toLowerCase();
  const has988 = /\b988\b/.test(answer);
  const hasLifeline = /988lifeline\.org/i.test(answer);
  if (has988 && hasLifeline) return answer;
  return answer.trimEnd() + HELP_CRISIS_RESOURCES_US;
}
