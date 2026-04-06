import { NextResponse } from "next/server";

type PostgrestStyleError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

export type PublicApiErrorPayload = {
  error: string;
  error_code: string;
  status: number;
  message_safe?: boolean;
  supabase_code?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type SupabaseErrorCategory =
  | "rls_denied"
  | "missing_table"
  | "missing_column"
  | "null_constraint"
  | "foreign_key_violation"
  | "duplicate_key"
  | "upsert_conflict"
  | "unknown";

export function logPublicApiRouteError(route: string, phase: string, err: unknown): void {
  if (err instanceof Error) {
    // Preserve useful logs in dev without being noisy in prod.
    if (process.env.NODE_ENV !== "production") {
      console.error(`[api/${route}] ${phase}:`, err.message);
      if (err.stack) console.error(err.stack);
    } else {
      console.error(`[api/${route}] ${phase}:`, err.message);
    }
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.error(`[api/${route}] ${phase}:`, err);
  } else {
    console.error(`[api/${route}] ${phase}: non-error thrown`);
  }
}

export function jsonApiErrorResponse(
  route: string,
  phase: string,
  payload: Omit<PublicApiErrorPayload, "status"> & { status?: number },
): NextResponse {
  const status = payload.status ?? 500;
  // Log a synthetic error so we retain stack in dev.
  logPublicApiRouteError(route, phase, new Error(payload.error));
  return NextResponse.json(
    {
      error: payload.error,
      error_code: payload.error_code,
      status,
      message_safe: payload.message_safe ?? false,
      supabase_code: payload.supabase_code ?? null,
      details: payload.details ?? null,
      hint: payload.hint ?? null,
    } satisfies PublicApiErrorPayload,
    { status },
  );
}

export function jsonSupabaseErrorResponse(
  route: string,
  phase: string,
  sErr: PostgrestStyleError,
  status = 500,
): NextResponse {
  return jsonApiErrorResponse(route, phase, {
    error: sErr.message,
    error_code: "database_error",
    status,
    message_safe: false,
    supabase_code: sErr.code ?? null,
    details: sErr.details ?? null,
    hint: sErr.hint ?? null,
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

export function categorizeSupabaseError(sErr: PostgrestStyleError): SupabaseErrorCategory {
  const code = str(sErr.code).toUpperCase();
  const msg = str(sErr.message).toLowerCase();
  const details = str(sErr.details).toLowerCase();
  const hint = str(sErr.hint).toLowerCase();
  const hay = `${msg}\n${details}\n${hint}`;

  // PostgreSQL SQLSTATE codes commonly surfaced by PostgREST/Supabase.
  if (code === "42501" || hay.includes("row-level security") || hay.includes("rls") || hay.includes("policy")) {
    return "rls_denied";
  }
  if ((code === "42P01" || hay.includes("relation")) && hay.includes("does not exist")) return "missing_table";
  if ((code === "42703" || hay.includes("column")) && hay.includes("does not exist")) return "missing_column";
  if (code === "23502" || (hay.includes("null value") && hay.includes("violates not-null"))) return "null_constraint";
  if (code === "23503" || (hay.includes("foreign key") && hay.includes("violates"))) return "foreign_key_violation";
  if (code === "23505" || hay.includes("duplicate key") || hay.includes("unique constraint")) {
    return hay.includes("on conflict") || hay.includes("upsert") ? "upsert_conflict" : "duplicate_key";
  }

  return "unknown";
}

export function httpStatusForSupabaseError(sErr: PostgrestStyleError): number {
  const cat = categorizeSupabaseError(sErr);
  if (cat === "rls_denied") return 403;
  if (cat === "null_constraint" || cat === "foreign_key_violation") return 400;
  if (cat === "duplicate_key" || cat === "upsert_conflict") return 409;
  // Missing table/column are server-side misconfigurations in production.
  return 500;
}

export function jsonConfigErrorResponse(route: string, phase: string, err: unknown): NextResponse {
  logPublicApiRouteError(route, phase, err);
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { error: message, error_code: "server_misconfigured", status: 503, message_safe: false },
    { status: 503 },
  );
}

export function jsonUnexpectedErrorResponse(route: string, phase: string, err: unknown): NextResponse {
  logPublicApiRouteError(route, phase, err);
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    { error: message, error_code: "internal_error", status: 500, message_safe: false },
    { status: 500 },
  );
}
