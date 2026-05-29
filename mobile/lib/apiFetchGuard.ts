import { siteOrigin } from "@/lib/env";

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setApiUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function headersHaveBearerAuth(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  const h = new Headers(headers);
  const auth = h.get("Authorization") ?? h.get("authorization");
  return !!auth && auth.toLowerCase().startsWith("bearer ");
}

function isSiteApiUrl(url: string): boolean {
  const origin = siteOrigin();
  if (!origin) return false;
  return url.startsWith(origin);
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestUsesBearerAuth(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (headersHaveBearerAuth(init?.headers)) return true;
  if (input instanceof Request) {
    const auth = input.headers.get("Authorization") ?? input.headers.get("authorization");
    return !!auth && auth.toLowerCase().startsWith("bearer ");
  }
  return false;
}

/** Intercepts 401 responses from the site API when the caller sent a Bearer token. */
export function installApiFetchGuard(): () => void {
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await nativeFetch(input, init);
    if (res.status !== 401 || !unauthorizedHandler) return res;

    const url = resolveRequestUrl(input);
    if (!isSiteApiUrl(url) || !requestUsesBearerAuth(input, init)) return res;

    unauthorizedHandler();
    return res;
  };

  return () => {
    globalThis.fetch = nativeFetch;
  };
}
