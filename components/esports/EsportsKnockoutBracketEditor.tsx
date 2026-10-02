"use client";

import { useState } from "react";
import { updateEsportsTournamentKnockoutBracket } from "@/app/admin/esports/actions";
import {
  KNOCKOUT_BRACKET_SAMPLE_JSON,
  parseKnockoutBracketStrictJsonString,
} from "@/lib/esports/knockoutBracket";
import { KnockoutBracketDisplay } from "@/components/esports/KnockoutBracketDisplay";

const SHAPE_HELP = `{ "rounds": [ { "name": "Quarterfinals", "matches": [ { "a": "Player 1", "b": "Player 2", "winner": "Player 1", "notes": "Thursday deadline", "deadline": "optional, e.g. Thu 11:59 PM ET" } ] } ] }`;

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
    <div className="mt-4 rounded-card border border-line bg-overlay-strong p-4">
      <h3 className="text-small font-semibold text-ink">Knockout bracket (JSON)</h3>
      <p className="mt-2 text-caption leading-relaxed text-muted">
        Optional public bracket on the tournament page. Leave the field empty to clear. Save runs validation: valid
        JSON, each round must have a <span className="text-muted">matches</span> array, and if{"  "}
        <span className="text-muted">winner</span> is set it must match <span className="text-muted">a</span> or{"  "}
        <span className="text-muted">b</span> exactly (case-insensitive). Omit{"  "}
        <span className="text-muted">a</span> / <span className="text-muted">b</span> or use{"  "}
        <span className="text-muted">TBD</span> for open slots.
      </p>
      <details className="mt-3 text-caption text-muted">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">
          Minimal example (round names are free text: Round of 16, Quarterfinals, …)
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-button border border-line bg-overlay-subtle p-3 font-mono text-caption leading-relaxed text-muted">
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
          className="rounded-button border border-line bg-overlay-subtle px-3 py-2 font-mono text-caption leading-relaxed text-ink placeholder:text-muted aria-invalid:border-coral"
          placeholder="Paste bracket JSON, or leave empty to clear…"
        />
        {(clientError || (draft.trim() !== "" && !parsed.ok)) && (
          <p className="text-caption font-medium text-coral" role="alert">
            {clientError ?? (parsed.ok ? "" : parsed.error)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-button border border-line bg-overlay-subtle px-4 py-2 text-small font-semibold text-ink hover:bg-overlay"
          >
            Save knockout bracket
          </button>
          <button
            type="button"
            className="rounded-button border border-line bg-overlay-subtle px-4 py-2 text-small font-semibold text-ink hover:bg-overlay"
            onClick={() => {
              setDraft(KNOCKOUT_BRACKET_SAMPLE_JSON.trim());
              setClientError(null);
            }}
          >
            Insert sample template
          </button>
          <button
            type="button"
            className="rounded-button border border-line bg-overlay-subtle px-4 py-2 text-small font-semibold text-ink hover:bg-overlay"
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
        <div className="mt-6 border-t border-line pt-6">
          <p className="text-caption font-semibold text-muted">Live preview</p>
          <p className="mt-1 text-caption text-muted">
            Same component as the public page (compact). Widen the panel or scroll horizontally on small screens.
          </p>
          <div className="mt-4 max-h-[min(32rem,75vh)] overflow-auto rounded-card border border-line bg-gradient-to-b from-ink to-ink p-4">
            <KnockoutBracketDisplay bracket={preview} compact />
          </div>
        </div>
      ) : draft.trim() !== "" && parsed.ok && !parsed.value ? (
        <p className="mt-4 text-caption text-muted">Preview: nothing to show (empty rounds array or no valid matches).</p>
      ) : null}
    </div>
  );
}
