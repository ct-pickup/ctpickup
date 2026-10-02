"use client";

import { Input } from "@/components/ui/input";
import {
  ESPORTS_CONSOLE_LABELS,
  ESPORTS_INTEREST_LABELS,
  ESPORTS_ONLINE_ID_MAX_LEN,
  ESPORTS_PLATFORM_LABELS,
  PLAYER_ESPORTS_GOALIE_COPY,
  consolesForPlatform,
  onlineIdLabelForPlatform,
  type EsportsConsole,
  type EsportsInterest,
  type EsportsPlatform,
} from "@/lib/profilePreferences";

type Variant = "signup" | "light";

const shell = {
  signup: {
    legend: "text-small font-medium text-ink",
    sub: "text-caption text-muted leading-relaxed",
    group: "flex flex-col gap-2 sm:flex-row sm:flex-wrap",
    optBase:
      "rounded-card border px-4 py-3 text-small font-medium text-center transition outline-none focus-visible:ring-2 focus-visible:ring-line",
    optOff: "border-line bg-canvas text-muted hover:border-line",
    optOn: "border-line bg-pitch text-on-pitch",
    block: "space-y-3 rounded-card border border-line bg-overlay-subtle p-4",
    callout: "rounded-button border border-coral bg-overlay-subtle px-3 py-2 text-caption text-coral leading-relaxed",
    textInput: "",
  },
  light: {
    legend: "text-small font-medium text-muted",
    sub: "text-caption text-muted leading-relaxed",
    group: "flex flex-col gap-2 sm:flex-row sm:flex-wrap",
    optBase: "rounded-button border px-4 py-3 text-small font-medium text-center transition outline-none focus-visible:ring-2 focus-visible:ring-line",
    optOff: "border-line bg-card text-muted hover:border-line",
    optOn: "border-line bg-canvas text-ink",
    block: "space-y-3 rounded-button border border-line bg-overlay p-4",
    callout: "rounded-button border border-coral bg-overlay-subtle px-3 py-2 text-caption text-coral leading-relaxed",
    textInput: "w-full rounded-button border border-line bg-card px-3 py-3 text-small text-muted placeholder:text-muted outline-none focus:border-line",
  },
} as const;

function ChoiceRow<T extends string>({
  variant,
  label,
  value,
  onChange,
  options,
  disabled,
  describedBy,
}: {
  variant: Variant;
  label: string;
  value: T | null;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  disabled?: boolean;
  describedBy?: string;
}) {
  const s = shell[variant];
  return (
    <div className={s.block}>
      <div className="mb-2">
        <div className={s.legend}>{label}</div>
      </div>
      <div className={s.group} role="group" aria-describedby={describedBy}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.id)}
              className={[s.optBase, on ? s.optOn : s.optOff, "flex-1 min-w-[7rem]"].join("  ")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type EsportsGoaliePreferenceFieldsProps = {
  variant: Variant;
  esportsInterest: EsportsInterest | null;
  onEsportsInterest: (v: EsportsInterest) => void;
  esportsPlatform: EsportsPlatform | null;
  onEsportsPlatform: (v: EsportsPlatform) => void;
  esportsConsole: EsportsConsole | null;
  onEsportsConsole: (v: EsportsConsole) => void;
  esportsOnlineId: string;
  onEsportsOnlineIdChange: (v: string) => void;
  disabled?: boolean;
  /** When interest is "later", show reminder about profile menu */
  showLaterReminder?: boolean;
  /** Incomplete esports (later or unset): show nudge at top of esports block */
  incompleteBanner?: string | null;
  /** Hide the top intro block (e.g. profile page already has a section heading). */
  hideIntro?: boolean;
};

export function EsportsGoaliePreferenceFields({
  variant,
  esportsInterest,
  onEsportsInterest,
  esportsPlatform,
  onEsportsPlatform,
  esportsConsole,
  onEsportsConsole,
  esportsOnlineId,
  onEsportsOnlineIdChange,
  disabled,
  showLaterReminder = true,
  incompleteBanner,
  hideIntro = false,
}: EsportsGoaliePreferenceFieldsProps) {
  const s = shell[variant];
  const interestOptions = (["yes", "no", "later"] as const).map((id) => ({
    id,
    label: ESPORTS_INTEREST_LABELS[id],
  }));

  const platformOptions = (["xbox", "playstation"] as const).map((id) => ({
    id,
    label: ESPORTS_PLATFORM_LABELS[id],
  }));

  const consoleOpts = esportsPlatform
    ? consolesForPlatform(esportsPlatform).map((id) => ({
        id,
        label: ESPORTS_CONSOLE_LABELS[id],
      }))
    : [];

  return (
    <div className="space-y-5">
      {incompleteBanner ? <div className={s.callout}>{incompleteBanner}</div> : null}

      {!hideIntro ? (
        <div className="space-y-1">
          <p className={s.legend}>{PLAYER_ESPORTS_GOALIE_COPY.introTitle}</p>
          <p className={s.sub}>{PLAYER_ESPORTS_GOALIE_COPY.introBody}</p>
        </div>
      ) : null}

      <ChoiceRow
        variant={variant}
        label={PLAYER_ESPORTS_GOALIE_COPY.questionTournament}
        value={esportsInterest}
        onChange={onEsportsInterest}
        options={interestOptions}
        disabled={disabled}
      />

      {esportsInterest === "later" && showLaterReminder ? (
        <p className={s.sub}>{PLAYER_ESPORTS_GOALIE_COPY.reminderLater}</p>
      ) : null}

      {esportsInterest === "yes" ? (
        <>
          <ChoiceRow
            variant={variant}
            label={PLAYER_ESPORTS_GOALIE_COPY.questionPlatform}
            value={esportsPlatform}
            onChange={onEsportsPlatform}
            options={platformOptions}
            disabled={disabled}
          />

          {esportsPlatform ? (
            <ChoiceRow
              variant={variant}
              label={PLAYER_ESPORTS_GOALIE_COPY.questionConsole}
              value={esportsConsole}
              onChange={onEsportsConsole}
              options={consoleOpts}
              disabled={disabled}
            />
          ) : null}

          {esportsPlatform && esportsConsole ? (
            <div className={s.block}>
              <label className="mb-2 block">
                <div className={s.legend}>{onlineIdLabelForPlatform(esportsPlatform)}</div>
                <Input
                  type="text"
                  autoComplete="off"
                  maxLength={ESPORTS_ONLINE_ID_MAX_LEN}
                  value={esportsOnlineId}
                  onChange={(e) => onEsportsOnlineIdChange(e.target.value)}
                  disabled={disabled}
                  className={
                    variant === "signup" ? "mt-2 w-full" : `mt-2 ${s.textInput}`
                  }
                  placeholder={esportsPlatform === "xbox" ? "e.g. PlayerOne123" : "e.g. YourPSN_ID"}
                />
              </label>
              <p className={`mt-2 ${s.sub}`}>{PLAYER_ESPORTS_GOALIE_COPY.onlineIdHelp}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
