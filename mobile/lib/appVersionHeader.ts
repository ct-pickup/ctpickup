import Constants from "expo-constants";
import { siteOrigin } from "@/lib/env";

export const APP_VERSION_HEADER = "x-app-version";

export function appVersion(): string {
  return String(Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "0.0.0").trim() || "0.0.0";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Sends x-app-version on every request to the site API; the server uses it to tell this build from v1.3.5. */
export function withAppVersionHeader(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  const origin = siteOrigin();
  if (!origin || !requestUrl(input).startsWith(origin)) return init;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has(APP_VERSION_HEADER)) headers.set(APP_VERSION_HEADER, appVersion());
  return { ...init, headers };
}

let installed = false;

export function installAppVersionHeader(): void {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => nativeFetch(input, withAppVersionHeader(input, init));
}

installAppVersionHeader();
