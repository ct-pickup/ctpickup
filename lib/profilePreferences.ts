/**
 * First-class profile fields: esports eligibility + goalie preference.
 * Stored on `profiles`; signup collects them, profile is the long-term editor.
 */

/** Player-facing strings for signup, onboarding, and profile (single source). */
export const PLAYER_ESPORTS_GOALIE_COPY = {
  introTitle: "Online tournaments (optional)",
  introBody:
    "If you might play in online events with prizes, tell us here. You can change this anytime—open Profile from the person icon at the top.",
  questionTournament:
    "Are you interested in online tournaments where you can win prize money?",
  reminderLater:
    "You can finish this anytime: tap the profile icon in the top corner, open Profile, and update your preferences there.",
  questionPlatform: "What do you play on?",
  questionConsole: "Which system do you have?",
  questionGoalie: "Are you open to playing goalie at pickup?",
  goalieHelp:
    "We use this to balance games—most sessions need at least two people who can play net.",
} as const;

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

/** True when user deferred or has never set interest (legacy rows). */
export function esportsSetupIncomplete(interest: string | null | undefined): boolean {
  return interest !== "yes" && interest !== "no";
}

export function esportsDetailsComplete(args: {
  esports_interest: string | null | undefined;
  esports_platform: string | null | undefined;
  esports_console: string | null | undefined;
}): boolean {
  if (args.esports_interest !== "yes") return true;
  return Boolean(parseEsportsPlatform(args.esports_platform) && parseEsportsConsole(args.esports_console));
}

export function formatEsportsSummary(row: {
  esports_interest?: string | null;
  esports_platform?: string | null;
  esports_console?: string | null;
}): string | null {
  const i = parseEsportsInterest(row.esports_interest ?? null);
  if (!i) return "Not set";
  if (i === "no") return "Not interested";
  if (i === "later") return "Decide later — finish in Profile (profile icon)";
  const plat = parseEsportsPlatform(row.esports_platform ?? null);
  const con = parseEsportsConsole(row.esports_console ?? null);
  if (!plat || !con) return "Interested — add platform below";
  return `${ESPORTS_PLATFORM_LABELS[plat]} · ${ESPORTS_CONSOLE_LABELS[con]}`;
}

/** Short line for banners / nudges outside the profile editor. */
export function esportsSetupNudgeMessage(interest: string | null | undefined): string {
  if (interest === "later") {
    return "You chose to decide later about online tournaments. Finish anytime in Profile — tap the profile icon at the top.";
  }
  return "Set your online tournament preference in Profile — tap the profile icon at the top.";
}

export function formatGoaliePreference(plays_goalie: boolean | null | undefined): string | null {
  if (plays_goalie === true) return "Yes";
  if (plays_goalie === false) return "No";
  return "Not set";
}

/**
 * DB columns for upsert/update from UI state. Clears platform/console when not "yes".
 */
export function profileEsportsGoalieColumns(args: {
  esportsInterest: EsportsInterest;
  esportsPlatform: EsportsPlatform | null;
  esportsConsole: EsportsConsole | null;
  playsGoalie: boolean;
}): {
  esports_interest: EsportsInterest;
  esports_platform: EsportsPlatform | null;
  esports_console: EsportsConsole | null;
  plays_goalie: boolean;
} {
  if (args.esportsInterest !== "yes") {
    return {
      esports_interest: args.esportsInterest,
      esports_platform: null,
      esports_console: null,
      plays_goalie: args.playsGoalie,
    };
  }
  return {
    esports_interest: "yes",
    esports_platform: args.esportsPlatform,
    esports_console: args.esportsConsole,
    plays_goalie: args.playsGoalie,
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
}): {
  interest: EsportsInterest | null;
  platform: EsportsPlatform | null;
  console: EsportsConsole | null;
} {
  const interest = args.interest;
  if (!interest || interest !== "yes") {
    return { interest, platform: null, console: null };
  }
  const platform = parseEsportsPlatform(args.platform);
  if (!platform) {
    return { interest: "yes", platform: null, console: null };
  }
  const allowed = consolesForPlatform(platform);
  const c = parseEsportsConsole(args.console);
  const consoleOk = c && allowed.includes(c) ? c : null;
  return { interest: "yes", platform, console: consoleOk };
}

type EsportsPrefSetters = {
  setInterest: (v: EsportsInterest | null) => void;
  setPlatform: (v: EsportsPlatform | null) => void;
  setConsole: (v: EsportsConsole | null) => void;
};

/**
 * Single implementation for interest/platform transitions (yes→no/later clears dependents; Xbox↔PlayStation clears console).
 */
export function bindEsportsPreferenceHandlers(setters: EsportsPrefSetters) {
  return {
    onEsportsInterest: (v: EsportsInterest) => {
      setters.setInterest(v);
      if (v !== "yes") {
        setters.setPlatform(null);
        setters.setConsole(null);
      }
    },
    onEsportsPlatform: (v: EsportsPlatform) => {
      setters.setPlatform(v);
      setters.setConsole(null);
    },
  };
}
