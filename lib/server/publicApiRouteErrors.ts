import { NextResponse } from "next/server";

type PostgrestStyleError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function logPublicApiRouteError(route: string, phase: string, err: unknown): void {
  if (err instanceof Error) {
    console.error(`[api/${route}] ${phase}:`, err.message);
    if (err.stack) console.error(err.stack);
    return;
  }
  console.error(`[api/${route}] ${phase}:`, err);
}

export function jsonSupabaseErrorResponse(
  route: string,
  phase: string,
  sErr: PostgrestStyleError,
  status = 500,
): NextResponse {
  logPublicApiRouteError(route, phase, new Error(sErr.message));
  return NextResponse.json(
    {
      // String `error` keeps existing clients working (they read j.error as text).
      error: sErr.message,
      error_code: "database_error",
      supabase_code: sErr.code ?? null,
      details: sErr.details ?? null,
      hint: sErr.hint ?? null,
    },
    { status },
  );
}

export function jsonConfigErrorResponse(route: string, phase: string, err: unknown): NextResponse {
  logPublicApiRouteError(route, phase, err);
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { error: message, error_code: "server_misconfigured" },
    { status: 503 },
  );
}

export function jsonUnexpectedErrorResponse(route: string, phase: string, err: unknown): NextResponse {
  logPublicApiRouteError(route, phase, err);
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message, error_code: "internal_error" }, { status: 500 });
}
