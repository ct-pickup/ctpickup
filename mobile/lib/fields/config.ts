/**
 * Dev-only switch. When on (and only in a development bundle) the Fields screens read the five built-in sample venues
 * instead of the venues table. Off by default, and ignored in release builds.
 *
 *   EXPO_PUBLIC_FIELDS_SAMPLE_DATA=true
 */
export const FIELDS_SAMPLE_DATA: boolean =
  __DEV__ && (process.env.EXPO_PUBLIC_FIELDS_SAMPLE_DATA ?? "").trim().toLowerCase() === "true";
