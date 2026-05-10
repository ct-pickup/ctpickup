import * as Haptics from "expo-haptics";

// Ball kick — general notification, invite
export async function hapticKick() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

// Goal — RSVP confirmed, run confirmed  
export async function hapticGoal() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

// Whistle — run started, award selected
export async function hapticWhistle() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

// Light tap — availability submitted, tier chips, buttons
export async function hapticTap() {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

// Error — something went wrong
export async function hapticError() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
