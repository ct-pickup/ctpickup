/**
 * Product naming. User-facing copy reads from here; identifiers, domains,
 * storage keys and the bundle ID keep their ctpickup names.
 */

export const PRODUCT_NAME = "Competitive Together";

/** Monogram and home-screen label. */
export const SHORT_NAME = "CT";

export const TAGLINE = "Good games. Better people.";

/** Contracting party in legal copy. Keep exactly as registered. */
export const LEGAL_ENTITY_NAME = "CT Pickup LLC";

/** Brand Instagram account, also the one players DM to verify. No leading @. */
export const INSTAGRAM_HANDLE = "competitivetogether";
export const INSTAGRAM_VERIFICATION_HANDLE = INSTAGRAM_HANDLE;

export const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`;
/** Opens the profile in the Instagram app; fall back to INSTAGRAM_URL when it can't open. */
export const INSTAGRAM_APP_URL = `instagram://user?username=${INSTAGRAM_HANDLE}`;
export const INSTAGRAM_VERIFICATION_URL = INSTAGRAM_URL;
