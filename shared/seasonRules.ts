/**
 * Season prize official rules: the single source for the website (/season-rules) and the in-app rules screen.
 * Plain English, numbered sections. Any [BRACKETED] item is a placeholder that must be filled before launch; the
 * page and the app render them highlighted (none are left at the moment). Behaviour described here comes from the code:
 *   - ranking and tie-break: lib/season/prizeRanking.ts
 *   - points and what counts as a posted result: lib/pickup/points.ts, lib/points/ledger.ts
 *   - entry: app/api/season-prize/entry/route.ts; disqualification: app/api/admin/season-prize/route.ts
 * Pure: no React, no Supabase.
 */

export const APPLE_DISCLAIMER = "Apple is not a sponsor of this contest.";

export type SeasonRulesInput = {
  prizeUsd: number;
  minGames: number;
  points: { played: number; win: number; draw: number; potd: number };
  /** The season the app is showing now, e.g. "Fall 2026", with Eastern-time dates. Reference only. */
  season: { label: string; startText: string; endText: string };
  rulesVersion: string;
};

export type RuleBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "link"; label: string; path: string };
export type RuleSection = { id: string; title: string; blocks: RuleBlock[] };

const p = (text: string): RuleBlock => ({ kind: "p", text });
const ul = (...items: string[]): RuleBlock => ({ kind: "ul", items });
const link = (label: string, path: string): RuleBlock => ({ kind: "link", label, path });

/** Text with [BRACKET] placeholders split out so a screen can highlight them. */
export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  return text
    .split(/(\[[^\]]+\])/g)
    .filter((t) => t !== "")
    .map((t) => ({ text: t, placeholder: /^\[[^\]]+\]$/.test(t) }));
}

/** Every distinct placeholder in the rules, in order of first appearance. */
export function listPlaceholders(sections: readonly RuleSection[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sections) {
    const texts = [s.title, ...s.blocks.flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "ul" ? b.items : []))];
    for (const t of texts) {
      for (const m of t.match(/\[[^\]]+\]/g) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          out.push(m);
        }
      }
    }
  }
  return out;
}

export function seasonRuleSections(i: SeasonRulesInput): RuleSection[] {
  const usd = `$${i.prizeUsd}`;
  return [
    {
      id: "sponsor",
      title: "1. Sponsor",
      blocks: [
        p("This contest is sponsored by CT Pickup LLC (doing business as Competitive Together), 2389 Main Street, STE 100, Glastonbury, CT 06033, United States (the “Sponsor”)."),
        p(`${APPLE_DISCLAIMER} Apple Inc. is not involved in this contest in any way.`),
      ],
    },
    {
      id: "no-purchase",
      title: "2. No purchase necessary",
      blocks: [
        p(
          "Entering is free. To enter, open the Competitive Together app, go to the season entry screen, tick the fair-play pledge and tap “Enter the season”. Entering costs nothing, and you do not have to buy or pay for anything to enter or to win.",
        ),
        p(
          "Buying a game spot, a subscription (such as CT+) or any other product does not improve your chances of winning. The winner is chosen only by the results described in section 5.",
        ),
        p(`No purchase is necessary to enter or to qualify. Games with no fee count toward the ${i.minGames}-game minimum exactly the same as paid games, so a player can qualify by playing only free games. Paying for a game does not improve a player\u2019s chances of winning, and paid and free games are counted identically.`),
      ],
    },
    {
      id: "eligibility",
      title: "3. Eligibility",
      blocks: [
        p("To be eligible to win you must:"),
        ul(
          "be 18 years of age or older;",
          "have entered the season in the app and accepted the fair-play pledge (playing games does not enter you automatically);",
          "not be disqualified from the season (section 7) and not be banned from Competitive Together; and",
          `have at least ${i.minGames} games with a posted result in the season (section 5).`,
        ),
        p("Employees, hosts and administrators of Competitive Together, and members of their households, are not eligible to win."),
      ],
    },
    {
      id: "dates",
      title: "4. Season dates and announcement",
      blocks: [
        p(`The ${i.season.label} season runs from ${i.season.startText} through ${i.season.endText}, Eastern Time. Only games played during the season count.`),
        p("The winner will be announced within 7 days after the season ends."),
        p("Seasons follow the app: Spring is March to May, Summer is June to August, Fall is September to November and Winter is December to February."),
      ],
    },
    {
      id: "winner",
      title: "5. How the winner is chosen",
      blocks: [
        p("There is one winner. The winner is chosen by results and skill, not by chance and not by a draw."),
        p("Points come only from games with a posted result in which you played on a team:"),
        ul(
          `${i.points.played} point${i.points.played === 1 ? "" : "s"} for playing in a game`,
          `${i.points.win} points for a win`,
          `${i.points.draw} point${i.points.draw === 1 ? "" : "s"} for a draw`,
          `${i.points.potd} points for Player of the Day (this can be awarded to a player who was not on a team)`,
        ),
        p(
          "A “posted result” is a game whose final result has been recorded in the app. A win is a game your team won (by score when both scores are recorded, otherwise by the winning team recorded). A draw is equal scores, or no winning team. A game counts toward the season it was played in, by its start time in Eastern Time. If a result is corrected, points are recalculated from the corrected result.",
        ),
        p("The winner is the eligible entrant who ranks first in this order:"),
        ul(
          "1. most season points;",
          "2. then most wins in the season;",
          "3. then most Player of the Day awards in the season;",
          "4. then the earliest season entry time.",
        ),
        p("Only entrants who meet every point of section 3 are ranked."),
      ],
    },
    {
      id: "prize",
      title: "6. Prize",
      blocks: [
        p(
          `There is one prize each season: ${usd} paid to the single winner by Venmo, PayPal or check, at the winner\u2019s choice. There is no second or third place prize. The prize cannot be substituted, transferred or exchanged, and there is no cash alternative other than the prize described here. The winner is responsible for any taxes on the prize.`,
        ),
      ],
    },
    {
      id: "disqualification",
      title: "7. Disqualification",
      blocks: [
        p(
          "By entering you accept the fair-play pledge: you will not fake games, results or votes, or work with others to inflate points. Cheating, fake results, vote trading, collusion, abuse of other players or staff, or a ban from Competitive Together can lead to disqualification. A disqualified player is removed from the ranking, and the prize goes to the next eligible player in the order in section 5. The Sponsor’s decision on any disqualification is final.",
        ),
      ],
    },
    {
      id: "claim",
      title: "8. Winner notification and claim",
      blocks: [
        p("The winner will be contacted through the app and by email and must claim the prize within 14 days of being notified."),
        p("If the prize is not claimed in that time, or the winner cannot be reached or is not eligible, the Sponsor may award it to the next eligible player in the order in section 5."),
      ],
    },
    {
      id: "general",
      title: "9. Void where prohibited; changes",
      blocks: [
        p("Void where prohibited by law. The Sponsor may change, suspend or cancel the contest, or these rules, for fairness or legal reasons. The current version of these rules is always the one shown in the app and on the website."),
      ],
    },
    {
      id: "privacy",
      title: "10. Data and privacy",
      blocks: [
        p(
          "To run the contest we record that your account entered the season, when you entered and which version of these rules you accepted, and we use your game results and points to rank players. Our Privacy Policy explains how we handle your data.",
        ),
        link("Read the Privacy Policy", "/privacy"),
      ],
    },
    {
      id: "contact",
      title: "11. Contact",
      blocks: [p("Questions about these rules: pickupct@gmail.com.")],
    },
  ];
}
