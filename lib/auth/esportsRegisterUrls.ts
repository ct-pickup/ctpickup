import { signupUrlForProtectedNavFirstVisit } from "@/lib/auth/signupIntent";

export function esportsRegisterPath(tournamentId: string): string {
  return `/esports/tournaments/${tournamentId}/register`;
}

/**
 * First-time browser: signup with gate + return to registration after profile.
 * Uses `next` on `/signup` (see signup page redirect).
 */
export function signupUrlForEsportsRegister(tournamentId: string): string {
  const next = esportsRegisterPath(tournamentId);
  const base = signupUrlForProtectedNavFirstVisit("tournament");
  const u = new URL(base, "http://local");
  u.searchParams.set("next", next);
  return `${u.pathname}${u.search}`;
}

export function loginUrlForEsportsRegister(tournamentId: string): string {
  return `/login?next=${encodeURIComponent(esportsRegisterPath(tournamentId))}`;
}
