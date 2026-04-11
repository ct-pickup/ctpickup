import type { EsportsConfirmationKey } from "./esportsConfirmationKeys";

export const ESPORTS_CONFIRMATION_LABELS: Record<EsportsConfirmationKey, string> = {
  age_18_plus: "I am at least 18 years old.",
  us_legal_resident: "I am a legal resident of the United States.",
  not_connecticut_resident: "I am not a resident of Connecticut.",
  agree_official_tournament_rules: "I agree to the Official Tournament Rules.",
  agree_terms_and_conditions: "I agree to the Terms and Conditions.",
  agree_privacy_publicity_policy: "I agree to the Privacy and Publicity Consent Policy.",
  agree_tournament_operational_sms:
    "I agree to receive tournament-related SMS messages at the mobile number on my CT Pickup account for operational tournament purposes—including group-stage assignments, opponent information, match times, schedule updates, check-in reminders, reporting instructions, and other logistics as described in Official Tournament Rules §4.4. These messages are not for marketing. Message and data rates may apply. I am responsible for providing and maintaining a valid mobile number capable of receiving SMS.",
  entry_fee_10_nonrefundable:
    "I understand the $10 entry fee: I may request a refund only if I do so more than 48 hours before the start of the first scheduled tournament match or the first official tournament match window, as shown on the tournament webpage (Official Tournament Rules §9); no refund if I request within 48 hours of that point, no-show, or disqualification; full refund if the Organizer cancels before play; duplicate or erroneous charges corrected as stated in the Official Tournament Rules.",
  publicity_streaming_consent:
    "I consent to photographs, audio/video recording, livestreaming, and online posting of my gamertag, voice, image, likeness, results, and tournament-related content as described in the Privacy and Publicity Consent Policy.",
  platform_account_requirements:
    "I understand platform and account requirements (EA account, PSN/Xbox, game ownership, internet, subscriptions) as described in the rules and policies.",
};
