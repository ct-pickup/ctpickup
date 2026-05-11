import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";

const KICK_SOUND = require("../assets/sounds/kick.mp3");
const WHISTLE_SOUND = require("../assets/sounds/whistle.mp3");

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

/** Loads, plays, then unloads. Swallows all errors. */
async function playSound(asset: number) {
  let sound: Audio.Sound | null = null;
  try {
    const created = await Audio.Sound.createAsync(asset, { shouldPlay: false });
    sound = created.sound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void sound?.unloadAsync();
        sound?.setOnPlaybackStatusUpdate(null);
      }
    });
    await sound.playAsync();
  } catch {
    // fail silently
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        /* ignore */
      }
    }
  }
}

// Ball kick — general notification, invite; medium impact for “submitting” actions
export async function hapticKick() {
  await Promise.all([
    playSound(KICK_SOUND),
    runHaptic("kick", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  ]);
}

// Goal — RSVP confirmed, run confirmed, primary confirm / join / submit taps
export async function hapticGoal() {
  await Promise.all([
    playSound(KICK_SOUND),
    runHaptic("goal", () =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    ),
  ]);
}

// Whistle — run started, result submitted (heavy)
export async function hapticWhistle() {
  await Promise.all([
    playSound(WHISTLE_SOUND),
    runHaptic("whistle", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  ]);
}

// Light tap — availability chips, award rows, secondary selections
export async function hapticTap() {
  await runHaptic("tap", () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// Error — ban, validation failures, API errors
export async function hapticError() {
  await runHaptic("error", () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  );
}
