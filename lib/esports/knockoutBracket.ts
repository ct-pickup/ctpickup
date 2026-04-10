/**
 * Shared parsing and validation for esports_tournaments.knockout_bracket (JSON).
 * Safe for public pages (never throws). Stricter validation for admin saves.
 */

export type KnockoutBracketMatch = {
  a: string;
  b: string;
  winner?: string;
  notes?: string;
  /** Optional human-readable deadline (e.g. "Thu 8pm ET"); reserved for future schedule sync */
  deadline?: string;
};

export type KnockoutBracketRound = {
  name: string;
  matches: KnockoutBracketMatch[];
};

export type KnockoutBracket = {
  rounds: KnockoutBracketRound[];
};

export const KNOCKOUT_BRACKET_SAMPLE_JSON = `{
  "rounds": [
    {
      "name": "Quarterfinals",
      "matches": [
        { "a": "Player 1", "b": "Player 2", "winner": "Player 1", "deadline": "Thu 11:59 PM ET", "notes": "Screenshot proof in Discord" },
        { "a": "Player 3", "b": "Player 4" }
      ]
    },
    {
      "name": "Semifinals",
      "matches": [
        { "a": "Player 1", "b": "TBD" }
      ]
    },
    {
      "name": "Final",
      "matches": [
        { "a": "TBD", "b": "TBD" }
      ]
    }
  ]
}`;

function asNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function normalizeSlot(v: unknown): string {
  const s = asNonEmptyString(v);
  return s ?? "TBD";
}

function parseMatch(raw: unknown): KnockoutBracketMatch | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const a = normalizeSlot(m.a);
  const b = normalizeSlot(m.b);
  const winner = asNonEmptyString(m.winner);
  const notes = asNonEmptyString(m.notes);
  const deadline = asNonEmptyString(m.deadline);
  const out: KnockoutBracketMatch = { a, b };
  if (winner) out.winner = winner;
  if (notes) out.notes = notes;
  if (deadline) out.deadline = deadline;
  return out;
}

function parseRound(raw: unknown, index: number): KnockoutBracketRound | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nameRaw = asNonEmptyString(r.name);
  const name = nameRaw ?? `Round ${index + 1}`;
  const matchesRaw = r.matches;
  if (!Array.isArray(matchesRaw)) return null;
  const matches = matchesRaw.map(parseMatch).filter(Boolean) as KnockoutBracketMatch[];
  if (matches.length === 0) return null;
  return { name, matches };
}

export type ParseKnockoutBracketResult =
  | { ok: true; value: KnockoutBracket | null }
  | { ok: false; error: string };

/**
 * Accepts DB JSON or API payload. Returns null when there is nothing to render (empty / no matches).
 * Does not throw.
 */
export function parseKnockoutBracket(raw: unknown): ParseKnockoutBracketResult {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "object") {
    return { ok: false, error: "Bracket must be a JSON object." };
  }
  const root = raw as Record<string, unknown>;
  const roundsRaw = root.rounds;
  if (roundsRaw === undefined) {
    return { ok: false, error: 'Missing "rounds" array.' };
  }
  if (!Array.isArray(roundsRaw)) {
    return { ok: false, error: '"rounds" must be an array.' };
  }
  const rounds: KnockoutBracketRound[] = [];
  for (let i = 0; i < roundsRaw.length; i++) {
    const pr = parseRound(roundsRaw[i], i);
    if (pr) rounds.push(pr);
  }
  if (rounds.length === 0) return { ok: true, value: null };
  return { ok: true, value: { rounds } };
}

/**
 * Never throws. On failure returns null (use empty state on public pages).
 */
export function safeKnockoutBracket(raw: unknown): KnockoutBracket | null {
  const r = parseKnockoutBracket(raw);
  if (!r.ok) return null;
  return r.value;
}

export function parseKnockoutBracketJsonString(json: string): ParseKnockoutBracketResult {
  const s = json.trim();
  if (!s) return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s) as unknown;
  } catch {
    return { ok: false, error: "Invalid JSON — check commas and quotes." };
  }
  return parseKnockoutBracket(parsed);
}

/**
 * Stricter checks for admin saves: every round must have a `matches` array; empty bracket allowed via `rounds: []`.
 */
export function parseKnockoutBracketStrict(raw: unknown): ParseKnockoutBracketResult {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "object") {
    return { ok: false, error: "Bracket must be a JSON object." };
  }
  const root = raw as Record<string, unknown>;
  const roundsRaw = root.rounds;
  if (roundsRaw === undefined) {
    return { ok: false, error: 'Missing "rounds" array.' };
  }
  if (!Array.isArray(roundsRaw)) {
    return { ok: false, error: '"rounds" must be an array.' };
  }
  const rounds: KnockoutBracketRound[] = [];
  for (let i = 0; i < roundsRaw.length; i++) {
    const item = roundsRaw[i];
    if (!item || typeof item !== "object") {
      return { ok: false, error: `Round ${i + 1} must be an object with "name" and "matches".` };
    }
    const r = item as Record<string, unknown>;
    if (!Array.isArray(r.matches)) {
      return { ok: false, error: `Round ${i + 1} must include a "matches" array.` };
    }
    for (let j = 0; j < r.matches.length; j++) {
      const m = r.matches[j];
      if (m !== null && typeof m !== "object") {
        return { ok: false, error: `Round ${i + 1}, match ${j + 1} must be a JSON object.` };
      }
    }
    const pr = parseRound(item, i);
    if (!pr) {
      return {
        ok: false,
        error: `Round ${i + 1} has no valid matches. Each match needs "a" and/or "b" (strings or omit for TBD).`,
      };
    }
    rounds.push(pr);
  }
  if (rounds.length === 0) return { ok: true, value: null };
  return { ok: true, value: { rounds } };
}

export function parseKnockoutBracketStrictJsonString(json: string): ParseKnockoutBracketResult {
  const s = json.trim();
  if (!s) return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(s) as unknown;
  } catch {
    return { ok: false, error: "Invalid JSON — check commas and quotes." };
  }
  return parseKnockoutBracketStrict(parsed);
}

/** First round index (0-based) with an undecided match; null if all decided or no bracket. */
export function currentRoundIndex(bracket: KnockoutBracket | null): number | null {
  if (!bracket?.rounds.length) return null;
  for (let i = 0; i < bracket.rounds.length; i++) {
    const undecided = bracket.rounds[i].matches.some((m) => !m.winner?.trim());
    if (undecided) return i;
  }
  return null;
}

export function winnerMatchesPlayer(winner: string, player: string): boolean {
  return winner.trim().toLowerCase() === player.trim().toLowerCase();
}
