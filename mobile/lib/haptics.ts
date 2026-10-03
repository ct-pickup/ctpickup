import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
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

let audioModeSet: Promise<void> | null = null;

/** Sound effects respect the silent switch and mix with other audio. */
function ensureAudioMode(): Promise<void> {
  audioModeSet ??= setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(
    () => {},
  );
  return audioModeSet;
}

/** Loads, plays, then releases. Swallows all errors. */
async function playSound(asset: number) {
  let player: AudioPlayer | null = null;
  try {
    await ensureAudioMode();
    const p = createAudioPlayer(asset);
    player = p;
    const sub = p.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        sub.remove();
        p.remove();
      }
    });
    p.play();
  } catch {
    // fail silently
    try {
      player?.remove();
    } catch {
      /* ignore */
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
