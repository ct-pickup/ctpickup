/**
 * Official Tournament Rules — harmonized with Terms + Privacy/Policy (cross-references, Section 10.4).
 */
export function EsportsOfficialRulesDocument() {
  return (
    <div className="space-y-6 text-sm leading-relaxed text-white/78 md:text-[15px] md:leading-7">
      <section>
        <h2 className="text-base font-semibold text-white">
          0. Relationship to Other Documents; Interpretation; Conflict Priority
        </h2>
        <p className="mt-2">
          These Official Tournament Rules (these “Rules”) operate together with the Terms and
          Conditions and the Privacy and Publicity Consent Policy (collectively, the “Documents”). The
          following priority applies:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <span className="text-white/90">Tournament-specific matters</span>—including competition
            format, eligibility, prizes, match administration, scoring, forfeits, refunds as expressly
            stated in these Rules, and dispute resolution for Tournament-related claims—are governed by{" "}
            <span className="text-white/90">these Rules</span>.
          </li>
          <li>
            <span className="text-white/90">Privacy, publicity, and personal data-use matters</span>{" "}
            are governed by the <span className="text-white/90">Privacy and Publicity Consent Policy</span>.
          </li>
          <li>
            <span className="text-white/90">General platform, account, website, and non-Tournament</span>{" "}
            use of the Platform (as defined in the Terms and Conditions) are governed by the{" "}
            <span className="text-white/90">Terms and Conditions</span>.
          </li>
          <li>
            If there is a <span className="text-white/90">direct conflict</span> between Documents on
            the same subject matter, the <span className="text-white/90">more specific</span> Document
            controls over the more general Document.
          </li>
          <li>
            Section 10 of these Rules works together with the Privacy and Publicity Consent Policy; if
            there is a conflict as to privacy, publicity, or data use, the{" "}
            <span className="text-white/90">Privacy and Publicity Consent Policy controls</span>.
          </li>
        </ul>
      </section>

      <p className="text-white/85">
        The organizer identified on the applicable Tournament webpage (the “Organizer”) adopts these
        Official Rules for each EA SPORTS FC 26 online tournament (each, a “Tournament”). These Rules
        constitute a legally binding contract between Organizer and each person who registers for or
        participates in a Tournament (“Participant”). By registering or participating, Participant
        agrees to comply with these Rules and all decisions made by Organizer.
      </p>

      <EsportsOfficialRulesSections1to9 />
      <EsportsOfficialRulesSections10to18 />
    </div>
  );
}

function EsportsOfficialRulesSections1to9() {
  return (
    <>
      <section>
        <h2 className="text-base font-semibold text-white">1. Nature of Tournament</h2>
        <p className="mt-2">
          Each Tournament is a skill-based competition. Outcomes are determined solely by each
          Participant’s individual performance in the EA SPORTS FC 26 video game. No element of chance
          determines winners, and there is no wagering, betting, or lottery.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">2. Organizer and Contact Information</h2>
        <p className="mt-2">
          <span className="text-white/90">Organizer:</span> The Organizer identified on the Tournament
          webpage.
        </p>
        <p className="mt-2">
          <span className="text-white/90">Address:</span> The mailing address identified on the
          Tournament webpage for official correspondence only.
        </p>
        <p className="mt-2">
          <span className="text-white/90">Support Email:</span> The support email identified on the
          Tournament webpage.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">3. Eligibility</h2>
        <h3 className="mt-3 text-sm font-semibold text-white/90">3.1 Age</h3>
        <p className="mt-2">
          Participants must be at least eighteen (18) years of age as of the start of the Tournament.
          Proof of age may be required. Minors may not participate.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">3.2 Residency</h3>
        <p className="mt-2">
          Participation is open to legal residents of the United States, except residents of
          Connecticut and any state or territory where participation in this Tournament would be
          unlawful. Organizer may refuse, limit, or cancel participation from any jurisdiction as needed
          to comply with applicable law.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">3.3 Account and Platform Requirements</h3>
        <p className="mt-2">
          Participants must own or have access to a valid EA account, PlayStation Network (“PSN”) or
          Xbox account, as applicable, and a copy of EA SPORTS FC 26 on the appropriate platform.
          Participants must have an active internet connection and any current subscription required for
          online play. Participants are responsible for any platform fees, subscription costs, and
          equipment requirements.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">4. Registration and Entry Fee</h2>
        <h3 className="mt-3 text-sm font-semibold text-white/90">4.1 Entry Fee</h3>
        <p className="mt-2">
          Participants may register by paying a non-refundable entry fee of US$10.00 per Tournament.
          The entry fee is charged for participation in the Tournament and to cover Organizer’s
          tournament administration and operating costs.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">4.2 Registration Procedure</h3>
        <p className="mt-2">
          Participants must complete the online registration form before the advertised deadline and
          provide accurate, complete information, including legal name, gamertag, contact email, and state
          of residence. Inaccurate, incomplete, or misleading information may result in rejection of
          registration or disqualification.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">4.3 Entry Fee Refunds</h3>
        <p className="mt-2">
          Entry fees are non-refundable except as expressly stated in Section 8 of these Rules.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">5. Prize Schedule</h2>
        <h3 className="mt-3 text-sm font-semibold text-white/90">5.1 Prize Schedule</h3>
        <p className="mt-2">
          Each Tournament will have a prize amount announced in advance on the Tournament registration
          page before registration opens. The advertised prize for a Tournament may vary based on the
          number of confirmed Participants only if the applicable prize tiers are fully disclosed in
          advance.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">5.2 Standard Prize Tiers</h3>
        <p className="mt-2">
          Unless Organizer publishes different prize tiers for a specific Tournament before
          registration opens, the following prize schedule will apply:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            (a) Fewer than 8 confirmed Participants: Organizer may cancel the Tournament and refund all
            entry fees, or reschedule the Tournament in Organizer’s sole discretion.
          </li>
          <li>(b) 8 to 15 confirmed Participants: First Place receives US$50.00.</li>
          <li>(c) 16 to 23 confirmed Participants: First Place receives US$100.00.</li>
          <li>(d) 24 to 31 confirmed Participants: First Place receives US$150.00.</li>
          <li>(e) 32 confirmed Participants: First Place receives US$200.00.</li>
        </ul>
        <h3 className="mt-4 text-sm font-semibold text-white/90">5.3 Prize Lock</h3>
        <p className="mt-2">
          The applicable prize tier for a Tournament will be determined based on the number of confirmed
          Participants when registration closes. Once registration closes, the applicable prize tier is
          locked and will not be increased or decreased after the Tournament begins.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">5.4 Prize Characteristics</h3>
        <p className="mt-2">
          The Tournament prize is a pre-announced amount determined by the applicable published prize
          tier. The amount of the prize will not be changed after registration closes.
        </p>
        <h3 className="mt-4 text-sm font-semibold text-white/90">5.5 Taxes</h3>
        <p className="mt-2">
          Winners are solely responsible for any federal, state, and local taxes associated with any
          prize. Organizer may require completion of an IRS Form W-9 before releasing a prize and may
          issue any required tax form where applicable.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">6. Tournament Format</h2>
        <p className="mt-2">
          <span className="font-semibold text-white/90">6.1 General Structure.</span> Each Tournament
          will consist of two phases: (a) a Round Robin Group Stage, followed by (b) a Single-Elimination
          Playoff Stage. Organizer will determine the exact number of groups and final bracket structure
          based on the total number of confirmed Participants. The Tournament will include no more than
          thirty-two (32) Participants. Where reasonably possible, groups will consist of four (4)
          Participants each. Organizer may publish the final group assignments, schedule, and playoff
          bracket after registration closes.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.2 Group Stage.</span> Participants will be
          placed into groups of approximately equal size. Each Participant will play one (1) match against
          every other Participant in that Participant’s group, unless Organizer announces a different
          format in advance. The Group Stage is intended to determine playoff qualification and playoff
          seeding. All Group Stage matches must be completed within the deadlines announced by Organizer.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.3 Group Stage Match Scoring.</span> For Group
          Stage standings, points will be awarded as follows: Win: 3 points; Draw: 1 point; Loss: 0
          points. Organizer may require Participants to submit match scores through the designated
          reporting system immediately after each match, along with screenshots or other proof if
          requested.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.4 Group Stage Tiebreakers.</span> If two or more
          Participants finish the Group Stage level on points, standings will be determined using the
          following tiebreakers, in this order: (a) head-to-head points among tied Participants; (b)
          head-to-head goal difference among tied Participants; (c) head-to-head goals scored among tied
          Participants; (d) overall goal difference in all Group Stage matches; (e) overall goals
          scored in all Group Stage matches; (f) fewest forfeits or administrative losses; (g) random draw
          conducted by Organizer. If more than two Participants are tied, Organizer may apply the above
          criteria repeatedly as needed to break the tie.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.5 Advancement to Playoffs.</span> The number of
          Participants who advance from each group to the Playoff Stage will be announced by Organizer
          before the first Group Stage match begins. Unless Organizer announces otherwise in advance:
          (a) the top two (2) finishers from each group will qualify for the Playoff Stage; and (b)
          playoff seeding will be based on Group Stage finish, points earned, and applicable tiebreakers.
          Organizer may include wild-card spots if needed to create a workable playoff bracket.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.6 Playoff Stage.</span> The Playoff Stage will
          be conducted as a single-elimination knockout bracket. A Participant who loses a Playoff match
          is eliminated from the Tournament. Organizer may determine playoff seeding in its sole
          discretion using Group Stage performance, including: (a) finishing position within the group;
          (b) total points; (c) goal difference; (d) goals scored; and (e) other applicable tiebreakers.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.7 Playoff Match Results.</span> If a Playoff
          match ends level at the end of regulation: (a) extra time will be played if available in the
          selected game settings; and (b) if still level, the match will be decided by penalty kicks.
          There are no draws in the Playoff Stage.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.8 Scheduling.</span> Organizer will publish a
          schedule, match windows, or deadlines for each Group Stage round and each Playoff round. Each
          Participant is responsible for: (a) monitoring Tournament communications; (b) being available
          during the scheduled match window; (c) responding reasonably and promptly to opponents and
          Organizer; and (d) completing matches before the applicable deadline. Failure to complete a
          scheduled match may result in a forfeit, administrative result, or disqualification, in
          Organizer’s sole discretion.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.9 No-Shows and Unplayed Matches.</span> If a
          Participant fails to appear for a scheduled match within ten (10) minutes of the scheduled
          start time, Organizer may declare that Participant to have forfeited unless Organizer
          determines that an extension is warranted. Unless Organizer decides otherwise, a forfeited
          match will be recorded as: (a) a 3-0 win for the non-offending Participant; and (b) a 0-3 loss
          for the offending Participant. If both Participants fail to cooperate, fail to schedule in good
          faith, or otherwise fail to complete a match by the deadline, Organizer may: (a) assign a
          double forfeit; (b) assign no points to either Participant; (c) assign an administrative draw; or
          (d) take any other action Organizer considers fair and appropriate.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.10 Participant Withdrawal During Group Stage.</span>{" "}
          If a Participant withdraws, is removed, or is disqualified during the Group Stage, Organizer
          may, in its sole discretion: (a) void that Participant’s unplayed matches; (b) void all of that
          Participant’s prior results; (c) keep completed results in the standings; or (d) apply
          administrative results to remaining scheduled matches. Organizer will choose the method that
          best preserves competitive fairness for the group as a whole.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.11 Disconnects, Server Issues, and Match Interruptions.</span>{" "}
          If a disconnect, server failure, or comparable technical issue occurs before halftime, the
          match will ordinarily be replayed in full unless Organizer directs otherwise. If the
          interruption occurs after halftime, Organizer may order: (a) a full replay; (b) a partial replay
          from a recreated scoreline if reasonably possible; (c) the score at interruption to stand; or
          (d) any other fair corrective action. Participants may be required to provide screenshots,
          video, or other proof. Repeated technical failures caused by one Participant’s setup may be
          treated as forfeits.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.12 Anti-Manipulation Rules.</span> Participants
          may not intentionally alter competitive integrity, including by: (a) deliberately losing for
          seeding purposes; (b) colluding to produce a preferred result; (c) manipulating scorelines to
          affect tiebreakers; (d) refusing to play in order to help another Participant qualify; or (e)
          engaging in any coordinated conduct that undermines fair competition. Organizer may
          disqualify any Participant or group of Participants for suspected manipulation.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">6.13 Organizer Authority Over Format Issues.</span>{" "}
          Organizer has the sole authority to interpret and apply this Tournament format, including all
          issues relating to: (a) standings; (b) tiebreakers; (c) qualification; (d) seeding; (e)
          forfeits; (f) replays; (g) administrative results; and (h) bracket corrections. All Organizer
          decisions are final and binding.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">7. Decisions and Disputes</h2>
        <p className="mt-2">
          <span className="font-semibold text-white/90">7.1 Organizer Authority.</span> Organizer has
          sole authority to interpret these Rules, administer the Tournament, determine eligibility, and
          resolve disputes. All decisions are final and binding.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">7.2 Reporting Results.</span> Participants must
          report match scores through the designated platform or reporting method within thirty (30)
          minutes of match completion. Opponents must confirm results if requested. Organizer may request
          proof of result.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">7.3 Dispute Resolution.</span> Any dispute that
          cannot be resolved through Organizer’s internal dispute process shall be resolved exclusively
          by binding arbitration as specified in Section 15, read together with the coordinated dispute
          provisions in the Terms and Conditions.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">8. Cancellation or Modification</h2>
        <p className="mt-2">
          Organizer reserves the right to cancel, suspend, postpone, or modify a Tournament or any part
          of it, for any reason including fraud, technical failure, insufficient participation, platform
          outages, or legal compliance. If a Tournament is canceled before any matches are played, entry
          fees will be refunded.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">9. Refund Policy</h2>
        <p className="mt-2">
          Entry fees are non-refundable except in the event of Tournament cancellation before play
          begins. Participants who withdraw or are disqualified are not entitled to a refund.
        </p>
      </section>
    </>
  );
}

function EsportsOfficialRulesSections10to18() {
  return (
    <>
      <section>
        <h2 className="text-base font-semibold text-white">10. Publicity and Use of Data</h2>
        <p className="mt-2">
          <span className="font-semibold text-white/90">10.1 Gamertags and Results.</span> Participants
          consent to Organizer’s use of their gamertag, bracket placement, and match results for purposes
          of administering the Tournament and publicly posting brackets, standings, and results on
          Organizer’s website and social media.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">10.2 Streaming and Tournament Content.</span>{" "}
          Organizer may stream matches or post clips, recaps, screenshots, and related Tournament
          content on its website, social media, or streaming channels. Participants grant Organizer a
          worldwide, perpetual, royalty-free license to broadcast and otherwise use their name, voice,
          gamertag, gameplay, and other Tournament-related identifying information for promotional,
          operational, and archival purposes related to the Tournament.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">10.3 Personal Information.</span> Organizer
          collects registration information solely to administer the Tournament, communicate with
          Participants, distribute prizes, enforce these Rules, and comply with legal obligations.
          Personal information will not be sold.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">10.4 Cross-Reference to Privacy and Publicity Consent Policy.</span>{" "}
          Detailed commitments regarding collection, use, disclosure, retention, security, choices, and
          publicity rights appear in the Privacy and Publicity Consent Policy. If there is a conflict
          between this Section 10 and the Privacy and Publicity Consent Policy as to privacy, publicity,
          or data use, the Privacy and Publicity Consent Policy controls.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">11. Limitation of Liability and Release</h2>
        <p className="mt-2">
          <span className="font-semibold text-white/90">11.1 Release.</span> By participating, each
          Participant releases and holds harmless Organizer, EA, Sony Interactive Entertainment,
          Microsoft, and their respective parents, subsidiaries, affiliates, officers, employees, and
          agents from any claims, damages, losses, or expenses arising out of participation, except to the
          extent arising from Organizer’s willful misconduct.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">11.2 Disclaimer.</span> Organizer provides the
          Tournament “as is” and disclaims all warranties, express or implied. Organizer does not
          guarantee continuous, uninterrupted, or secure access to Tournament services.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">11.3 Limitation.</span> In no event will
          Organizer’s liability exceed the greater of (a) the entry fee paid by the Participant, or (b)
          US$50. Some jurisdictions do not allow limitations of liability, so these may not apply.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">12. Indemnification</h2>
        <p className="mt-2">
          Participant agrees to indemnify and hold harmless Organizer from any third-party claims arising
          from Participant’s breach of these Rules, misuse of the Tournament platform or reporting
          system, or violation of law.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">13. Relationship to EA and Platforms</h2>
        <p className="mt-2">
          This Tournament is not sponsored by, endorsed by, administered by, or affiliated with Electronic
          Arts Inc., Sony Interactive Entertainment, Microsoft Corporation, Instagram, Twitch, YouTube, or
          their respective affiliates. All EA SPORTS FC trademarks are property of Electronic Arts Inc.
          EA’s published content policy also says not to imply endorsement or affiliation.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">14. Governing Law</h2>
        <p className="mt-2">
          These Rules and any disputes are governed by the laws of the State of Connecticut, without
          regard to conflict-of-laws principles.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">15. Arbitration Agreement</h2>
        <p className="mt-2">
          <span className="font-semibold text-white/90">15.1 Agreement to Arbitrate.</span> Any dispute
          or claim arising out of this Tournament or these Rules that cannot be resolved informally must
          be resolved by binding arbitration administered by JAMS under its Streamlined Arbitration
          Rules.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">15.2 Class Action Waiver.</span> Proceedings will
          be conducted only on an individual basis. No class or collective actions are permitted.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">15.3 Forum.</span> Arbitration will take place in
          Hartford County, Connecticut, unless otherwise agreed.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">15.4 Pre-Arbitration Notice.</span> Before
          initiating arbitration, a party must provide written notice of the dispute and attempt
          informal resolution.
        </p>
        <p className="mt-3">
          <span className="font-semibold text-white/90">15.5 Coordination with Terms and Conditions.</span>{" "}
          Tournament-related claims are subject to this Section 15 and Section 11.2 of the Terms and
          Conditions. Platform-only claims are subject to Section 11.3 of the Terms and Conditions, which
          incorporates this arbitration framework.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">16. Severability</h2>
        <p className="mt-2">
          If any provision of these Rules is held to be unlawful or unenforceable, that provision shall
          be severed, and the remainder shall remain in full force.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">17. Entire Agreement</h2>
        <p className="mt-2">
          These Rules constitute the entire agreement regarding the Tournament and supersede all prior
          communications on the same subject, read together with the Terms and Conditions and the Privacy
          and Publicity Consent Policy as described in Section 0.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">18. Contact Information</h2>
        <p className="mt-2">
          For questions, contact the support email listed on the Tournament webpage.
        </p>
      </section>
    </>
  );
}
