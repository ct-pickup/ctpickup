/**
 * First-class profile fields: esports eligibility (optional online tournaments).
 * Stored on `profiles`; onboarding and profile are the editors.
 */

/** Player-facing strings for signup, onboarding, and profile (single source). */
export const PLAYER_ESPORTS_GOALIE_COPY = {
  introTitle: "Weekly online money tournaments (optional)",
  introBody:
    "Separate from ice pickup: if you might join weekly online tournaments for money, answer below. You can change this anytime in Profile.",
  questionTournament:
    "Do you want to join weekly online tournaments to make money?",
  reminderLater:
    "You can finish this anytime: tap the profile icon in the top corner, open Profile, and update your preferences there.",
  questionPlatform: "What do you play on?",
  questionConsole: "Which system do you have?",
  questionOnlineIdXbox: "What is your Xbox gamertag?",
  questionOnlineIdPlaystation: "What is your PlayStation online ID?",
  onlineIdHelp: "We use this to invite you to the right bracket and verify it’s you.",
} as const;

export const ESPORTS_ONLINE_ID_MAX_LEN = 64;

export type EsportsInterest = "yes" | "no" | "later";
export type EsportsPlatform = "xbox" | "playstation";
export type EsportsConsole = "xbox_series_xs" | "xbox_one" | "ps5" | "ps4";

export const ESPORTS_INTEREST_LABELS: Record<EsportsInterest, string> = {
  yes: "Yes, interested",
  no: "No",
  later: "Decide later",
};

export const ESPORTS_PLATFORM_LABELS: Record<EsportsPlatform, string> = {
  xbox: "Xbox",
  playstation: "PlayStation",
};

export const ESPORTS_CONSOLE_LABELS: Record<EsportsConsole, string> = {
  xbox_series_xs: "Xbox Series X/S",
  xbox_one: "Xbox One",
  ps5: "PlayStation 5",
  ps4: "PlayStation 4",
};

export function consolesForPlatform(p: EsportsPlatform): EsportsConsole[] {
  if (p === "xbox") return ["xbox_series_xs", "xbox_one"];
  return ["ps5", "ps4"];
}

export function parseEsportsInterest(raw: string | null | undefined): EsportsInterest | null {
  if (raw === "yes" || raw === "no" || raw === "later") return raw;
  return null;
}

export function parseEsportsPlatform(raw: string | null | undefined): EsportsPlatform | null {
  if (raw === "xbox" || raw === "playstation") return raw;
  return null;
}

export function parseEsportsConsole(raw: string | null | undefined): EsportsConsole | null {
  if (
    raw === "xbox_series_xs" ||
    raw === "xbox_one" ||
    raw === "ps5" ||
    raw === "ps4"
  ) {
    return raw;
  }
  return null;
}

export function onlineIdLabelForPlatform(p: EsportsPlatform): string {
  return p === "xbox"
    ? PLAYER_ESPORTS_GOALIE_COPY.questionOnlineIdXbox
    : PLAYER_ESPORTS_GOALIE_COPY.questionOnlineIdPlaystation;
}

/** Trim + max length; empty input → null for persistence. */
export function normalizeEsportsOnlineId(raw: string | null | undefined): string | null {
  const t = String(raw ?? "")
    .trim()
    .slice(0, ESPORTS_ONLINE_ID_MAX_LEN);
  return t.length > 0 ? t : null;
}

/** True when user deferred or has never set interest (legacy rows). */
export function esportsSetupIncomplete(interest: string | null | undefined): boolean {
  return interest !== "yes" && interest !== "no";
}

export function esportsDetailsComplete(args: {
  esports_interest: string | null | undefined;
  esports_platform: string | null | undefined;
  esports_console: string | null | undefined;
  esports_online_id?: string | null | undefined;
}): boolean {
  if (args.esports_interest !== "yes") return true;
  if (!parseEsportsPlatform(args.esports_platform) || !parseEsportsConsole(args.esports_console)) {
    return false;
  }
  return Boolean(normalizeEsportsOnlineId(args.esports_online_id ?? null));
}

/**
 * True when the user should be nudged to open Profile for esports: unset/later, or `yes` without
 * full platform + console + online ID (matches save validation).
 */
export function esportsFlowNeedsAttention(row: {
  esports_interest?: string | null;
  esports_platform?: string | null;
  esports_console?: string | null;
  esports_online_id?: string | null;
}): boolean {
  const interest = parseEsportsInterest(row.esports_interest ?? null);
  if (interest === null || interest === "later") return true;
  if (interest === "no") return false;
  return !esportsDetailsComplete({
    esports_interest: "yes",
    esports_platform: row.esports_platform,
    esports_console: row.esports_console,
    esports_online_id: row.esports_online_id,
  });
}

export function formatEsportsSummary(row: {
  esports_interest?: string | null;
  esports_platform?: string | null;
  esports_console?: string | null;
  esports_online_id?: string | null;
}): string | null {
  const i = parseEsportsInterest(row.esports_interest ?? null);
  if (!i) return "Not set";
  if (i === "no") return "Not interested";
  if (i === "later") return "Decide later — finish in Profile (profile icon)";
  const plat = parseEsportsPlatform(row.esports_platform ?? null);
  const con = parseEsportsConsole(row.esports_console ?? null);
  const oid = normalizeEsportsOnlineId(row.esports_online_id ?? null);
  if (!plat || !con) return "Interested — add platform below";
  const base = `${ESPORTS_PLATFORM_LABELS[plat]} · ${ESPORTS_CONSOLE_LABELS[con]}`;
  if (!oid) return `${base} — add gamertag / online ID below`;
  return `${base} · ${oid}`;
}

/** Short line for banners / nudges outside the profile editor. */
export function esportsSetupNudgeMessage(interest: string | null | undefined): string {
  if (interest === "later") {
    return "You chose to decide later about online tournaments. Finish anytime in Profile — tap the profile icon at the top.";
  }
  return "Set your online tournament preference in Profile — tap the profile icon at the top.";
}

/** Banner / nudge copy when `esportsFlowNeedsAttention` is true. */
export function esportsProfileNudgeCopy(row: {
  esports_interest?: string | null;
  esports_platform?: string | null;
  esports_console?: string | null;
  esports_online_id?: string | null;
}): string | null {
  if (!esportsFlowNeedsAttention(row)) return null;
  const raw = row.esports_interest;
  if (raw === "yes") {
    return "Your online tournament details aren’t finished. Open Profile (tap the profile icon) to add platform, console, and your gamertag or online ID.";
  }
  return esportsSetupNudgeMessage(raw);
}

/**
 * DB columns for upsert/update from UI state. Clears platform/console when not "yes".
 */
export function profileEsportsPreferenceColumns(args: {
  esportsInterest: EsportsInterest;
  esportsPlatform: EsportsPlatform | null;
  esportsConsole: EsportsConsole | null;
  esportsOnlineId: string;
}): {
  esports_interest: EsportsInterest;
  esports_platform: EsportsPlatform | null;
  esports_console: EsportsConsole | null;
  esports_online_id: string | null;
} {
  if (args.esportsInterest !== "yes") {
    return {
      esports_interest: args.esportsInterest,
      esports_platform: null,
      esports_console: null,
      esports_online_id: null,
    };
  }
  return {
    esports_interest: "yes",
    esports_platform: args.esportsPlatform,
    esports_console: args.esportsConsole,
    esports_online_id: normalizeEsportsOnlineId(args.esportsOnlineId),
  };
}

/**
 * Normalize loaded or edited state so platform/console never linger when they should not apply
 * (e.g. yes + PlayStation + Xbox-only console from bad data).
 */
export function sanitizeEsportsFormState(args: {
  interest: EsportsInterest | null;
  platform: EsportsPlatform | null;
  console: EsportsConsole | null;
  onlineId: string;
}): {
  interest: EsportsInterest | null;
  platform: EsportsPlatform | null;
  console: EsportsConsole | null;
  onlineId: string;
} {
  const interest = args.interest;
  if (!interest || interest !== "yes") {
    return { interest, platform: null, console: null, onlineId: "" };
  }
  const platform = parseEsportsPlatform(args.platform);
  if (!platform) {
    return { interest: "yes", platform: null, console: null, onlineId: "" };
  }
  const allowed = consolesForPlatform(platform);
  const c = parseEsportsConsole(args.console);
  const consoleOk = c && allowed.includes(c) ? c : null;
  if (!consoleOk) {
    return { interest: "yes", platform, console: null, onlineId: "" };
  }
  return {
    interest: "yes",
    platform,
    console: consoleOk,
    onlineId: args.onlineId.trim().slice(0, ESPORTS_ONLINE_ID_MAX_LEN),
  };
}

type EsportsPrefSetters = {
  setInterest: (v: EsportsInterest | null) => void;
  setPlatform: (v: EsportsPlatform | null) => void;
  setConsole: (v: EsportsConsole | null) => void;
  setOnlineId: (v: string) => void;
};

/**
 * Single implementation for transitions:
 * yes→no/later clears platform, console, online ID;
 * Xbox↔PlayStation clears console + online ID (IDs are platform-specific).
 */
export function bindEsportsPreferenceHandlers(setters: EsportsPrefSetters) {
  return {
    onEsportsInterest: (v: EsportsInterest) => {
      setters.setInterest(v);
      if (v !== "yes") {
        setters.setPlatform(null);
        setters.setConsole(null);
        setters.setOnlineId("");
      }
    },
    onEsportsPlatform: (v: EsportsPlatform) => {
      setters.setPlatform(v);
      setters.setConsole(null);
      setters.setOnlineId("");
    },
  };
}
