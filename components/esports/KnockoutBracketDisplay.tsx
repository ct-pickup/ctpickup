import type { KnockoutBracket } from "@/lib/esports/knockoutBracket";
import { currentRoundIndex, winnerMatchesPlayer } from "@/lib/esports/knockoutBracket";

function roundFullyDecided(round: KnockoutBracket["rounds"][0]): boolean {
  return round.matches.every((m) => Boolean(m.winner?.trim()));
}

function slotLabel(name: string): string {
  const t = name.trim();
  return t.length ? t : "TBD";
}

function MatchCard({
  match,
  matchIndex,
  compact,
}: {
  match: KnockoutBracket["rounds"][0]["matches"][0];
  matchIndex: number;
  compact?: boolean;
}) {
  const aWin = match.winner ? winnerMatchesPlayer(match.winner, match.a) : false;
  const bWin = match.winner ? winnerMatchesPlayer(match.winner, match.b) : false;
  const pending = !match.winner?.trim();
  const rowText = compact ? "text-xs" : "text-sm";

  return (
    <article
      className={`rounded-xl border border-white/12 bg-black/25 shadow-sm shadow-black/20 ${
        compact ? "p-2" : "p-3"
      }`}
      aria-label={`Match ${matchIndex + 1}`}
    >
      <div className="space-y-1.5">
        <div
          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${rowText} ${
            aWin
              ? "border border-[var(--brand)]/45 bg-[var(--brand)]/[0.12] text-white"
              : pending
                ? "border border-white/8 bg-white/[0.03] text-white/85"
                : "border border-transparent bg-white/[0.02] text-white/55 line-through decoration-white/25"
          }`}
        >
          <span className="min-w-0 truncate font-medium">{slotLabel(match.a)}</span>
          {aWin ? (
            <span
              className={`shrink-0 font-semibold uppercase tracking-wider text-[var(--brand)] ${
                compact ? "text-[9px]" : "text-[10px]"
              }`}
            >
              Winner
            </span>
          ) : null}
        </div>
        <div
          className={`px-1 text-center font-medium uppercase tracking-[0.16em] text-white/35 ${
            compact ? "text-[9px]" : "text-[10px]"
          }`}
        >
          vs
        </div>
        <div
          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 ${rowText} ${
            bWin
              ? "border border-[var(--brand)]/45 bg-[var(--brand)]/[0.12] text-white"
              : pending
                ? "border border-white/8 bg-white/[0.03] text-white/85"
                : "border border-transparent bg-white/[0.02] text-white/55 line-through decoration-white/25"
          }`}
        >
          <span className="min-w-0 truncate font-medium">{slotLabel(match.b)}</span>
          {bWin ? (
            <span
              className={`shrink-0 font-semibold uppercase tracking-wider text-[var(--brand)] ${
                compact ? "text-[9px]" : "text-[10px]"
              }`}
            >
              Winner
            </span>
          ) : null}
        </div>
      </div>
      {match.winner && !aWin && !bWin ? (
        <p className={`mt-2 text-amber-200/85 ${compact ? "text-[11px]" : "text-xs"}`}>
          Winner recorded: <span className="font-medium text-white/90">{match.winner}</span>
        </p>
      ) : null}
      {match.deadline ? (
        <p className={`mt-2 text-white/50 ${compact ? "text-[11px]" : "text-xs"}`}>
          <span className="text-white/40">Deadline:</span> {match.deadline}
        </p>
      ) : null}
      {match.notes ? (
        <p
          className={`mt-2 border-t border-white/10 pt-2 leading-relaxed text-white/50 ${
            compact ? "text-[11px]" : "text-xs"
          }`}
        >
          {match.notes}
        </p>
      ) : null}
    </article>
  );
}

function RoundColumn({
  round,
  isCurrent,
  isComplete,
  compact,
}: {
  round: KnockoutBracket["rounds"][0];
  isCurrent: boolean;
  isComplete: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 md:min-w-[14.5rem] md:max-w-[16rem] ${
        compact ? "md:min-w-[12rem] md:max-w-[13rem]" : ""
      }`}
    >
      <div
        className={`sticky top-0 z-[1] -mx-1 rounded-lg px-2 py-2 md:static md:mx-0 md:bg-transparent md:p-0 ${
          isCurrent ? "bg-[var(--brand)]/15 ring-1 ring-[var(--brand)]/35" : "bg-black/40 md:bg-transparent"
        }`}
      >
        <h3
          className={`text-center font-semibold uppercase tracking-[0.18em] text-white/90 md:text-left ${
            compact ? "text-[10px]" : "text-[11px]"
          }`}
        >
          {round.name}
        </h3>
        <div className="mt-1 flex flex-wrap justify-center gap-1.5 md:justify-start">
          {isCurrent ? (
            <span
              className={`rounded-full bg-[var(--brand)]/20 px-2 py-0.5 font-semibold uppercase tracking-wide text-[var(--brand)] ${
                compact ? "text-[9px]" : "text-[10px]"
              }`}
            >
              Current
            </span>
          ) : null}
          {isComplete ? (
            <span
              className={`rounded-full bg-white/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-white/55 ${
                compact ? "text-[9px]" : "text-[10px]"
              }`}
            >
              Complete
            </span>
          ) : null}
        </div>
      </div>
      <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
        {round.matches.map((m, j) => (
          <MatchCard key={`${j}-${m.a}-${m.b}`} match={m} matchIndex={j} compact={compact} />
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

  return (
    <div className={className}>
      <div className="md:hidden">
        <div className="flex flex-col gap-10">
          {bracket.rounds.map((round, idx) => {
            const isCurrent = currentIdx === idx;
            const showComplete =
              !isCurrent &&
              roundFullyDecided(round) &&
              (tournamentComplete ? idx === bracket.rounds.length - 1 : currentIdx !== null && idx < currentIdx);
            return (
              <RoundColumn
                key={`${round.name}-${idx}`}
                round={round}
                isCurrent={isCurrent}
                isComplete={showComplete}
                compact={compact}
              />
            );
          })}
        </div>
      </div>

      <div className="hidden md:block">
        <div className="relative overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
          <div className="flex min-w-min flex-row items-start gap-0">
            {bracket.rounds.map((round, idx) => {
              const isCurrent = currentIdx === idx;
              const showComplete =
                !isCurrent &&
                roundFullyDecided(round) &&
                (tournamentComplete ? idx === bracket.rounds.length - 1 : currentIdx !== null && idx < currentIdx);
              return (
                <div key={`${round.name}-${idx}`} className="flex items-stretch">
                  {idx > 0 ? (
                    <div
                      className="mx-3 w-px shrink-0 self-stretch bg-gradient-to-b from-transparent via-white/20 to-transparent"
                      aria-hidden
                    />
                  ) : null}
                  <RoundColumn
                    round={round}
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
