import type { EsportsConfirmationKey } from "./esportsConfirmationKeys";

export const ESPORTS_CONFIRMATION_LABELS: Record<EsportsConfirmationKey, string> = {
  age_18_plus: "I am at least 18 years old.",
  us_legal_resident: "I am a legal resident of the United States.",
  not_connecticut_resident: "I am not a resident of Connecticut.",
  agree_official_tournament_rules: "I agree to the Official Tournament Rules.",
  agree_terms_and_conditions: "I agree to the Terms and Conditions.",
  agree_privacy_publicity_policy: "I agree to the Privacy and Publicity Consent Policy.",
  entry_fee_10_nonrefundable:
    "I understand the entry fee is $10 and is non-refundable except where the rules say otherwise.",
  publicity_streaming_consent:
    "I consent to publicity, streaming, and posting of my gamertag, results, and tournament-related content as described in the Privacy and Publicity Consent Policy.",
  platform_account_requirements:
    "I understand platform and account requirements (EA account, PSN/Xbox, game ownership, internet, subscriptions) as described in the rules and policies.",
};
