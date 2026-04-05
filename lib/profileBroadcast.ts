/** Fired after profile/avatar changes so the top bar can refetch. */
export const PROFILE_UPDATED_EVENT = "ctpickup:profile-updated";

export function broadcastProfileUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}
