import type { EsportsConfirmationKey } from "./esportsConfirmationKeys";
import { ESPORTS_CONFIRMATION_KEYS } from "./esportsConfirmationKeys";

export type EsportsConfirmations = Record<EsportsConfirmationKey, boolean>;

export { ESPORTS_CONFIRMATION_KEYS };

export function esportsConfirmationsComplete(c: Partial<EsportsConfirmations> | null | undefined): c is EsportsConfirmations {
  if (!c) return false;
  return ESPORTS_CONFIRMATION_KEYS.every((k) => c[k] === true);
}
