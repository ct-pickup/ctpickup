import type { RequestStatus } from "../../../shared/fields/requestEmail";

export type TrackerStepState = "done" | "todo" | "declined";
export type TrackerStep = { title: string; sub: string; state: TrackerStepState };

/** Short label for a status, as the player sees it. */
export function statusLabel(status: RequestStatus): string {
  switch (status) {
    case "new":
      return "Received";
    case "waiting_on_school":
      return "Waiting on the venue";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
  }
}

/** The four-step tracker for a request. A declined request ends at "Venue declined" and never reaches "You're confirmed". */
export function trackerSteps(status: RequestStatus): TrackerStep[] {
  const received: TrackerStep = { title: "Received by Competitive Together", sub: "We have your request", state: "done" };
  const sending = (done: boolean): TrackerStep => ({
    title: "Sending to the venue",
    sub: "Our team sends the facility-use request",
    state: done ? "done" : "todo",
  });
  switch (status) {
    case "new":
      return [received, sending(false), { title: "Venue approves", sub: "We'll notify you", state: "todo" }, { title: "You're confirmed", sub: "Pay and invite your players", state: "todo" }];
    case "waiting_on_school":
      return [received, sending(true), { title: "Venue approves", sub: "We'll notify you", state: "todo" }, { title: "You're confirmed", sub: "Pay and invite your players", state: "todo" }];
    case "approved":
      return [received, sending(true), { title: "Venue approves", sub: "Approved", state: "done" }, { title: "You're confirmed", sub: "Pay and invite your players", state: "done" }];
    case "declined":
      return [received, sending(true), { title: "Venue declined", sub: "Try another field or time", state: "declined" }];
    case "cancelled":
      return [received, { title: "Cancelled", sub: "This request was cancelled", state: "declined" }];
  }
}
