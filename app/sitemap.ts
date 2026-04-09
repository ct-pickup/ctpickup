import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

/** High-value public URLs for discovery; auth-only areas are omitted. */
const PATHS: string[] = [
  "/",
  "/after-login",
  "/login",
  "/signup",
  "/pickup",
  "/pickup/join-a-game",
  "/pickup/upcoming-games",
  "/pickup/how-it-works",
  "/tournament",
  "/tournament/how-it-works",
  "/training",
  "/u23",
  "/esports",
  "/esports/tournaments",
  "/guidance",
  "/community",
  "/mission",
  "/rules",
  "/info",
  "/help",
  "/terms",
  "/privacy",
  "/liability-waiver",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PATHS.map((path) => ({
    url: `${SITE_ORIGIN}${path === "/" ? "" : path}`,
    lastModified,
    changeFrequency: path === "/" || path === "/after-login" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/after-login" ? 0.95 : 0.8,
  }));
}
