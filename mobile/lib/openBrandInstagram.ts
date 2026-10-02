import { Linking } from "react-native";

import { INSTAGRAM_APP_URL, INSTAGRAM_URL } from "@/lib/brand";

/** Brand profile in the Instagram app, or the web profile when the app isn't installed. */
export async function openBrandInstagram(): Promise<void> {
  try {
    await Linking.openURL(INSTAGRAM_APP_URL);
  } catch {
    await Linking.openURL(INSTAGRAM_URL).catch(() => undefined);
  }
}
