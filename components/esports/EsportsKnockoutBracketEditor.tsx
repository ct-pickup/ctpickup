"use client";

import { useState } from "react";
import { updateEsportsTournamentKnockoutBracket } from "@/app/admin/esports/actions";
import {
  KNOCKOUT_BRACKET_SAMPLE_JSON,
  parseKnockoutBracketStrictJsonString,
} from "@/lib/esports/knockoutBracket";
import { KnockoutBracketDisplay } from "@/components/esports/KnockoutBracketDisplay";

const SHAPE_HELP = `{
  "rounds": [
    {
      "name": "Quarterfinals",
      "matches": [
        {
          "a": "Player 1",
          "b": "Player 2",
          "winner": "Player 1",
          "notes": "Thursday deadline",
          "deadline": "optional, e.g. Thu 11:59 PM ET"
        }
      ]
    }
  ]
}`;

type Props = {
  tournamentId: string;
  initialJson: string;
};

export function EsportsKnockoutBracketEditor({ tournamentId, initialJson }: Props) {
  const [draft, setDraft] = useState(initialJson);
  const [clientError, setClientError] = useState<string | null>(null);

  const parsed = parseKnockoutBracketStrictJsonString(draft);
  const preview = parsed.ok ? parsed.value : null;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white">Knockout bracket (JSON)</h3>
      <p className="mt-2 text-xs leading-relaxed text-white/55">
        Optional public bracket on the tournament page. Leave the field empty to clear. Save runs validation: valid
        JSON, each round must have a <span className="text-white/75">matches</span> array, and if{" "}
        <span className="text-white/75">winner</span> is set it must match <span className="text-white/75">a</span> or{" "}
        <span className="text-white/75">b</span> exactly (case-insensitive). Omit{" "}
        <span className="text-white/75">a</span> / <span className="text-white/75">b</span> or use{" "}
        <span className="text-white/75">TBD</span> for open slots.
      </p>
      <details className="mt-3 text-xs text-white/50">
        <summary className="cursor-pointer select-none text-white/65 hover:text-white/80">
          Minimal example (round names are free text: Round of 16, Quarterfinals, …)
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/70">
          {SHAPE_HELP}
        </pre>
      </details>
      <form
        action={updateEsportsTournamentKnockoutBracket}
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          const check = parseKnockoutBracketStrictJsonString(draft);
          if (!check.ok) {
            e.preventDefault();
            setClientError(check.error);
            return;
          }
          setClientError(null);
        }}
      >
        <input type="hidden" name="id" value={tournamentId} />
        <input type="hidden" name="knockout_bracket" value={draft} />
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setClientError(null);
          }}
          rows={12}
          spellCheck={false}
          aria-invalid={Boolean(clientError) || (draft.trim() !== "" && !parsed.ok)}
          className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-white placeholder:text-white/35 aria-invalid:border-amber-500/50"
          placeholder="Paste bracket JSON, or leave empty to clear…"
        />
        {(clientError || (draft.trim() !== "" && !parsed.ok)) && (
          <p className="text-xs font-medium text-amber-200/95" role="alert">
            {clientError ?? (parsed.ok ? "" : parsed.error)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Save knockout bracket
          </button>
          <button
            type="button"
            className="rounded-md border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.07]"
            onClick={() => {
              setDraft(KNOCKOUT_BRACKET_SAMPLE_JSON.trim());
              setClientError(null);
            }}
          >
            Insert sample template
          </button>
          <button
            type="button"
            className="rounded-md border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.07]"
            onClick={() => {
              setDraft("");
              setClientError(null);
            }}
          >
            Clear
          </button>
        </div>
      </form>
      {preview ? (
        <div className="mt-6 border-t border-white/10 pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Live preview</p>
          <p className="mt-1 text-xs text-white/45">
            Same component as the public page (compact). Widen the panel or scroll horizontally on small screens.
          </p>
          <div className="mt-4 max-h-[min(32rem,75vh)] overflow-auto rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4">
            <KnockoutBracketDisplay bracket={preview} compact />
          </div>
        </div>
      ) : draft.trim() !== "" && parsed.ok && !parsed.value ? (
        <p className="mt-4 text-xs text-white/45">Preview: nothing to show (empty rounds array or no valid matches).</p>
      ) : null}
    </div>
  );
}
