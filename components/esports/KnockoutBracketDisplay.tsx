import type { KnockoutBracket } from "@/lib/esports/knockoutBracket";
import { currentRoundIndex, winnerMatchesPlayer } from "@/lib/esports/knockoutBracket";

function roundFullyDecided(round: KnockoutBracket["rounds"][0]): boolean {
  return round.matches.every((m) => Boolean(m.winner?.trim()));
}

function isTbdSlot(name: string): boolean {
  const t = name.trim();
  return t.length === 0 || t.toLowerCase() === "tbd";
}

function PlayerRow({
  name,
  isWinner,
  isEliminated,
  pending,
  compact,
}: {
  name: string;
  isWinner: boolean;
  isEliminated: boolean;
  pending: boolean;
  compact?: boolean;
}) {
  const tbd = isTbdSlot(name);
  const rowText = compact ? "text-xs" : "text-sm";
  const label = tbd ? "TBD" : name;

  return (
    <div
      className={`flex min-h-[2.5rem] items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${rowText} ${
        isWinner
          ? "border border-[var(--brand)]/50 bg-[var(--brand)]/[0.14] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset]"
          : pending
            ? tbd
              ? "border border-dashed border-white/15 bg-white/[0.02] text-white/40"
              : "border border-white/10 bg-white/[0.04] text-white/90"
            : isEliminated
              ? "border border-transparent bg-white/[0.02] text-white/45 line-through decoration-white/20"
              : "border border-white/8 bg-white/[0.03] text-white/80"
      }`}
    >
      <span
        className={`min-w-0 truncate font-medium ${tbd && pending ? "italic tracking-wide" : ""}`}
      >
        {label}
      </span>
      {isWinner ? (
        <span
          className={`shrink-0 rounded bg-[var(--brand)]/25 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-[var(--brand)] ${
            compact ? "text-[9px]" : "text-[10px]"
          }`}
        >
          Won
        </span>
      ) : null}
    </div>
  );
}

function MatchCard({
  match,
  matchIndex,
  roundIndex,
  isInCurrentRound,
  compact,
}: {
  match: KnockoutBracket["rounds"][0]["matches"][0];
  matchIndex: number;
  roundIndex: number;
  isInCurrentRound: boolean;
  compact?: boolean;
}) {
  const aWin = match.winner ? winnerMatchesPlayer(match.winner, match.a) : false;
  const bWin = match.winner ? winnerMatchesPlayer(match.winner, match.b) : false;
  const pending = !match.winner?.trim();

  return (
    <article
      className={`rounded-xl border bg-black/30 shadow-sm shadow-black/25 ${
        isInCurrentRound
          ? "border-[var(--brand)]/35 ring-1 ring-[var(--brand)]/20"
          : "border-white/12"
      } ${compact ? "p-2" : "p-3"}`}
      aria-label={`Round ${roundIndex + 1}, match ${matchIndex + 1}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`font-semibold uppercase tracking-[0.12em] text-white/40 ${
            compact ? "text-[9px]" : "text-[10px]"
          }`}
        >
          Match {matchIndex + 1}
        </span>
      </div>
      <div className="space-y-1">
        <PlayerRow
          name={match.a}
          isWinner={aWin}
          isEliminated={!pending && !aWin}
          pending={pending}
          compact={compact}
        />
        <div
          className={`px-1 py-0.5 text-center font-semibold uppercase tracking-[0.2em] text-white/30 ${
            compact ? "text-[9px]" : "text-[10px]"
          }`}
        >
          vs
        </div>
        <PlayerRow
          name={match.b}
          isWinner={bWin}
          isEliminated={!pending && !bWin}
          pending={pending}
          compact={compact}
        />
      </div>
      {match.winner && !aWin && !bWin ? (
        <p className={`mt-2 text-amber-200/90 ${compact ? "text-[11px]" : "text-xs"}`}>
          Winner recorded: <span className="font-medium text-white/90">{match.winner}</span>
          <span className="block text-white/45">Does not match A or B — fix in admin JSON.</span>
        </p>
      ) : null}
      {match.deadline ? (
        <p className={`mt-2 text-white/50 ${compact ? "text-[11px]" : "text-xs"}`}>
          <span className="font-medium text-white/40">Deadline</span> · {match.deadline}
        </p>
      ) : null}
      {match.notes ? (
        <p
          className={`mt-2 border-t border-white/10 pt-2 leading-relaxed text-white/55 ${
            compact ? "text-[11px]" : "text-xs"
          }`}
        >
          {match.notes}
        </p>
      ) : null}
    </article>
  );
}

/** Visual spine between round columns (desktop). */
function RoundConnector() {
  return (
    <div className="flex w-7 shrink-0 flex-col items-center justify-center self-stretch" aria-hidden>
      <div className="relative flex h-full min-h-[4rem] w-full items-center justify-center">
        <div className="absolute inset-y-[12%] left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/25 to-transparent" />
        <div className="relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/35">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="opacity-80" aria-hidden>
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function RoundColumn({
  round,
  roundIndex,
  totalRounds,
  isCurrent,
  isComplete,
  compact,
}: {
  round: KnockoutBracket["rounds"][0];
  roundIndex: number;
  totalRounds: number;
  isCurrent: boolean;
  isComplete: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-4 md:min-w-[15rem] md:max-w-[17rem] ${
        compact ? "md:min-w-[12.5rem] md:max-w-[14rem]" : ""
      }`}
    >
      <div
        className={`rounded-xl px-3 py-3 md:px-0 md:py-0 ${
          isCurrent
            ? "bg-[var(--brand)]/[0.12] ring-1 ring-[var(--brand)]/40 md:bg-transparent md:ring-0"
            : ""
        }`}
      >
        <p
          className={`text-center font-medium uppercase tracking-[0.2em] text-white/40 md:text-left ${
            compact ? "text-[9px]" : "text-[10px]"
          }`}
        >
          Round {roundIndex + 1} of {totalRounds}
        </p>
        <h3
          className={`mt-1 text-center font-bold uppercase tracking-[0.14em] text-white md:text-left ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {round.name}
        </h3>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5 md:justify-start">
          {isCurrent ? (
            <span
              className={`rounded-full bg-[var(--brand)]/25 px-2.5 py-0.5 font-bold uppercase tracking-wide text-[var(--brand)] ${
                compact ? "text-[9px]" : "text-[10px]"
              }`}
            >
              Current round
            </span>
          ) : null}
          {isComplete ? (
            <span
              className={`rounded-full bg-white/10 px-2.5 py-0.5 font-bold uppercase tracking-wide text-white/50 ${
                compact ? "text-[9px]" : "text-[10px]"
              }`}
            >
              Complete
            </span>
          ) : null}
        </div>
      </div>
      <div className={`flex flex-col ${compact ? "gap-2.5" : "gap-3.5"}`}>
        {round.matches.map((m, j) => (
          <MatchCard
            key={`r${roundIndex}-m${j}`}
            match={m}
            matchIndex={j}
            roundIndex={roundIndex}
            isInCurrentRound={isCurrent}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

export function KnockoutBracketDisplay({
  bracket,
  compact,
  className = "",
}: {
  bracket: KnockoutBracket;
  /** Smaller type and spacing for admin preview */
  compact?: boolean;
  className?: string;
}) {
  const currentIdx = currentRoundIndex(bracket);
  const tournamentComplete = bracket.rounds.length > 0 && currentIdx === null;
  const totalRounds = bracket.rounds.length;

  return (
    <div className={className}>
      {tournamentComplete ? (
        <div className="mb-6 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3 text-center md:text-left">
          <p className="text-sm font-semibold text-emerald-100/95">Bracket complete</p>
          <p className="mt-0.5 text-xs text-emerald-100/65">All knockout matches have a recorded winner.</p>
        </div>
      ) : null}

      <div className="md:hidden">
        <div className="flex flex-col gap-12">
          {bracket.rounds.map((round, idx) => {
            const isCurrent = currentIdx === idx;
            const showComplete =
              !isCurrent &&
              roundFullyDecided(round) &&
              (tournamentComplete
                ? idx === bracket.rounds.length - 1
                : currentIdx !== null && idx < currentIdx);
            return (
              <RoundColumn
                key={`m-${idx}`}
                round={round}
                roundIndex={idx}
                totalRounds={totalRounds}
                isCurrent={isCurrent}
                isComplete={showComplete}
                compact={compact}
              />
            );
          })}
        </div>
      </div>

      <div className="hidden md:block">
        <div className="relative overflow-x-auto pb-3 [-webkit-overflow-scrolling:touch]">
          <div className="flex min-w-min flex-row items-stretch gap-0">
            {bracket.rounds.map((round, idx) => {
              const isCurrent = currentIdx === idx;
              const showComplete =
                !isCurrent &&
                roundFullyDecided(round) &&
                (tournamentComplete
                  ? idx === bracket.rounds.length - 1
                  : currentIdx !== null && idx < currentIdx);
              return (
                <div key={`d-${idx}`} className="flex items-stretch">
                  {idx > 0 ? <RoundConnector /> : null}
                  <RoundColumn
                    round={round}
                    roundIndex={idx}
                    totalRounds={totalRounds}
                    isCurrent={isCurrent}
                    isComplete={showComplete}
                    compact={compact}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
