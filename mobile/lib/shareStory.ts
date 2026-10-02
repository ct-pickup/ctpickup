/* eslint-disable @typescript-eslint/no-require-imports -- optional native modules, required lazily so Expo Go and older dev builds still load */
import { NativeModules, Platform, TurboModuleRegistry, type View } from "react-native";
import type { RefObject } from "react";

type CaptureOptions = { format: "png" | "jpg"; quality: number; width: number; height: number; result: "tmpfile" };
type ViewShotModule = { captureRef: (target: RefObject<View | null>, options: CaptureOptions) => Promise<string> };
type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (url: string, options?: { mimeType?: string; UTI?: string; dialogTitle?: string }) => Promise<void>;
};

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

let cached: { viewShot: ViewShotModule; sharing: SharingModule } | null | undefined;

/**
 * Both packages need native code (react-native-view-shot, expo-sharing). In Expo Go, on web, or in a dev
 * client built before they were added, this returns null and the Share button stays hidden.
 */
function loadModules(): { viewShot: ViewShotModule; sharing: SharingModule } | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS === "web") return cached;
  try {
    const hasViewShot = Boolean(TurboModuleRegistry.get("RNViewShot") ?? NativeModules.RNViewShot);
    if (!hasViewShot) return cached;
    const viewShot = require("react-native-view-shot") as ViewShotModule;
    const sharing = require("expo-sharing") as SharingModule;
    if (typeof viewShot?.captureRef !== "function" || typeof sharing?.shareAsync !== "function") return cached;
    cached = { viewShot, sharing };
  } catch (e) {
    console.warn("[share] story sharing unavailable:", e instanceof Error ? e.message : String(e));
  }
  return cached;
}

export async function canShareStory(): Promise<boolean> {
  const mods = loadModules();
  if (!mods) return false;
  try {
    return await mods.sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Renders `target` to a 1080×1920 PNG and opens the system share sheet (Save Image, Instagram Stories, Messages). */
export async function shareStoryImage(target: RefObject<View | null>, dialogTitle: string): Promise<void> {
  const mods = loadModules();
  if (!mods) throw new Error("Sharing needs the latest app build.");
  const uri = await mods.viewShot.captureRef(target, {
    format: "png",
    quality: 1,
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    result: "tmpfile",
  });
  const url = uri.startsWith("file://") ? uri : `file://${uri}`;
  await mods.sharing.shareAsync(url, { mimeType: "image/png", UTI: "public.png", dialogTitle });
}
