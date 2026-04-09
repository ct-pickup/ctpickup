export const ESPORTS_CONFIRMATION_KEYS = [
  "age_18_plus",
  "us_legal_resident",
  "not_connecticut_resident",
  "agree_official_tournament_rules",
  "agree_terms_and_conditions",
  "agree_privacy_publicity_policy",
  "entry_fee_10_nonrefundable",
  "publicity_streaming_consent",
  "platform_account_requirements",
] as const;

export type EsportsConfirmationKey = (typeof ESPORTS_CONFIRMATION_KEYS)[number];
