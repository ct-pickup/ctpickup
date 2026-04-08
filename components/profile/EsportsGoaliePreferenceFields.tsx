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

/** `all` = goalie then online events (default). Split flows use `goalie` / `esports` on separate steps. */
export type EsportsGoalieSection = "all" | "goalie" | "esports";

const shell = {
  signup: {
    legend: "text-sm font-medium text-white/90",
    sub: "text-xs text-white/50 leading-relaxed",
    group: "flex flex-col gap-2 sm:flex-row sm:flex-wrap",
    optBase:
      "rounded-xl border px-4 py-3 text-sm font-medium text-center transition outline-none focus-visible:ring-2 focus-visible:ring-white/30",
    optOff: "border-white/15 bg-black text-white/75 hover:border-white/25",
    optOn: "border-white bg-white text-black",
    block: "space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4",
    callout: "rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90 leading-relaxed",
  },
  light: {
    legend: "text-sm font-medium text-gray-900",
    sub: "text-xs text-gray-600 leading-relaxed",
    group: "flex flex-col gap-2 sm:flex-row sm:flex-wrap",
    optBase: "rounded-lg border px-4 py-3 text-sm font-medium text-center transition outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
    optOff: "border-gray-300 bg-white text-gray-800 hover:border-gray-400",
    optOn: "border-gray-900 bg-gray-900 text-white",
    block: "space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4",
    callout: "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900/90 leading-relaxed",
    textInput: "w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-500",
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
              className={[s.optBase, on ? s.optOn : s.optOff, "flex-1 min-w-[7rem]"].join(" ")}
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
  /** Default `all`: pickup goalie first, then optional online tournaments. */
  section?: EsportsGoalieSection;
  esportsInterest: EsportsInterest | null;
  onEsportsInterest: (v: EsportsInterest) => void;
  esportsPlatform: EsportsPlatform | null;
  onEsportsPlatform: (v: EsportsPlatform) => void;
  esportsConsole: EsportsConsole | null;
  onEsportsConsole: (v: EsportsConsole) => void;
  esportsOnlineId: string;
  onEsportsOnlineIdChange: (v: string) => void;
  playsGoalie: boolean | null;
  onPlaysGoalie: (v: boolean) => void;
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
  section = "all",
  esportsInterest,
  onEsportsInterest,
  esportsPlatform,
  onEsportsPlatform,
  esportsConsole,
  onEsportsConsole,
  esportsOnlineId,
  onEsportsOnlineIdChange,
  playsGoalie,
  onPlaysGoalie,
  disabled,
  showLaterReminder = true,
  incompleteBanner,
  hideIntro = false,
}: EsportsGoaliePreferenceFieldsProps) {
  const s = shell[variant];
  const showGoalie = section === "all" || section === "goalie";
  const showEsports = section === "all" || section === "esports";
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

  const esportsBlock = (
    <>
      {showEsports && incompleteBanner ? <div className={s.callout}>{incompleteBanner}</div> : null}

      {showEsports && !hideIntro ? (
        <div className="space-y-1">
          <p className={s.legend}>{PLAYER_ESPORTS_GOALIE_COPY.introTitle}</p>
          <p className={s.sub}>{PLAYER_ESPORTS_GOALIE_COPY.introBody}</p>
        </div>
      ) : null}

      {showEsports ? (
        <>
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
                      className={variant === "signup" ? "mt-2 w-full" : `mt-2 ${s.textInput}`}
                      placeholder={esportsPlatform === "xbox" ? "e.g. PlayerOne123" : "e.g. YourPSN_ID"}
                    />
                  </label>
                  <p className={`mt-2 ${s.sub}`}>{PLAYER_ESPORTS_GOALIE_COPY.onlineIdHelp}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );

  const goalieBlock = showGoalie ? (
    <>
      {section === "goalie" ? <p className={s.sub}>{PLAYER_ESPORTS_GOALIE_COPY.goalieSectionLead}</p> : null}
      <ChoiceRow
        variant={variant}
        label={PLAYER_ESPORTS_GOALIE_COPY.questionGoalie}
        value={playsGoalie === null ? null : playsGoalie ? "yes" : "no"}
        onChange={(v) => onPlaysGoalie(v === "yes")}
        options={[
          { id: "yes" as const, label: "Yes" },
          { id: "no" as const, label: "No" },
        ]}
        disabled={disabled}
      />
      <p className={s.sub}>{PLAYER_ESPORTS_GOALIE_COPY.goalieHelp}</p>
    </>
  ) : null;

  return (
    <div className="space-y-5">
      {section === "all" ? (
        <>
          {goalieBlock}
          {esportsBlock}
        </>
      ) : section === "goalie" ? (
        goalieBlock
      ) : (
        esportsBlock
      )}
    </div>
  );
}
