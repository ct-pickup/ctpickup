import * as Haptics from "expo-haptics";

function warnHaptic(name: string, err: unknown) {
  if (__DEV__) console.warn(`[haptics] ${name} failed:`, err);
}

async function runHaptic(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    warnHaptic(name, e);
  }
}

// Ball kick — general notification, invite; medium impact for “submitting” actions
export async function hapticKick() {
  await runHaptic("kick", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

// Goal — RSVP confirmed, run confirmed, primary confirm / join / submit taps
export async function hapticGoal() {
  await runHaptic("goal", () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

// Whistle — run started, result submitted (heavy)
export async function hapticWhistle() {
  await runHaptic("whistle", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

// Light tap — availability chips, award rows, secondary selections
export async function hapticTap() {
  await runHaptic("tap", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// Error — ban, validation failures, API errors
export async function hapticError() {
  await runHaptic("error", () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
