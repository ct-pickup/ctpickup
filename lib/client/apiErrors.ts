export type NormalizedApiError = {
  error?: unknown;
  error_code?: unknown;
  status?: unknown;
  message_safe?: unknown;
  supabase_code?: unknown;
  details?: unknown;
  hint?: unknown;
};

type SupabaseCategory =
  | "rls_denied"
  | "missing_table"
  | "missing_column"
  | "null_constraint"
  | "foreign_key_violation"
  | "duplicate_key"
  | "upsert_conflict"
  | "unknown";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toStr(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return null;
  return String(v);
}

function looksLikeNetworkFailure(err: unknown): boolean {
  // Fetch throws TypeError on network issues (incl. CORS, DNS, offline).
  if (err instanceof TypeError) return true;
  const m = err instanceof Error ? err.message : toStr(err);
  if (!m) return false;
  return /failed to fetch|networkerror|load failed|connection/i.test(m);
}

function categorizeSupabaseError(e: NormalizedApiError): SupabaseCategory {
  const code = toStr(e.supabase_code)?.toUpperCase() || "";
  const msg = (toStr(e.error) || "").toLowerCase();
  const details = (toStr(e.details) || "").toLowerCase();
  const hint = (toStr(e.hint) || "").toLowerCase();
  const hay = `${msg}\n${details}\n${hint}`;

  // PostgreSQL SQLSTATE codes (common through PostgREST/Supabase):
  if (code === "42501" || hay.includes("row-level security") || hay.includes("rls") || hay.includes("policy")) {
    return "rls_denied";
  }
  if (code === "42P01" || hay.includes("does not exist") && hay.includes("relation")) return "missing_table";
  if (code === "42703" || hay.includes("does not exist") && hay.includes("column")) return "missing_column";
  if (code === "23502" || hay.includes("null value") && hay.includes("violates not-null")) return "null_constraint";
  if (code === "23503" || hay.includes("foreign key") && hay.includes("violates")) return "foreign_key_violation";
  if (code === "23505" || hay.includes("duplicate key") || hay.includes("unique constraint")) {
    // Most upsert conflicts surface as duplicate key violations.
    return hay.includes("on conflict") || hay.includes("upsert") ? "upsert_conflict" : "duplicate_key";
  }

  return "unknown";
}

export function userFacingMessageForHttpStatus(status: number, opts?: { safeServerMessage?: string | null }) {
  const safe = opts?.safeServerMessage?.trim();
  switch (status) {
    case 400:
      return safe || "Something was invalid. Please review and try again.";
    case 401:
      return "Please sign in and try again.";
    case 403:
      return "You do not have permission to do that.";
    case 404:
      return "We couldn’t find what you were trying to update.";
    case 409:
      return "This action is no longer available because the state changed.";
    case 429:
      return "Too many attempts. Please wait and try again.";
    default:
      if (status >= 500) return "Something went wrong on our side. Please try again.";
      return "Something went wrong. Please try again.";
  }
}

export function userFacingMessageForError(input: {
  err?: unknown;
  response?: Response | null;
  data?: unknown;
}) {
  const { err, response, data } = input;

  if (looksLikeNetworkFailure(err)) {
    return "Connection issue. Check your internet and try again.";
  }

  const status = response?.status;
  const body = isObject(data) ? (data as NormalizedApiError) : (isObject(err) ? (err as NormalizedApiError) : null);

  const safeServerMessage =
    body && body.message_safe === true ? toStr(body.error) : null;

  if (typeof status === "number") {
    // If the backend is telling us it's a database error, refine the message
    // using Supabase category + status mapping requirements.
    if (body?.error_code === "database_error") {
      const cat = categorizeSupabaseError(body);
      if (cat === "rls_denied") return "You do not have permission to do that.";
      if (cat === "null_constraint" || cat === "foreign_key_violation") {
        return userFacingMessageForHttpStatus(400, { safeServerMessage });
      }
      if (cat === "duplicate_key" || cat === "upsert_conflict") {
        return userFacingMessageForHttpStatus(409);
      }
      // missing table/column or unknown -> treat as server-side
      return userFacingMessageForHttpStatus(status);
    }

    return userFacingMessageForHttpStatus(status, { safeServerMessage });
  }

  // If we don't have a status, fall back.
  return "Something went wrong. Please try again.";
}

export async function readJsonSafely(res: Response): Promise<{ data: unknown; isJson: boolean }> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return { data: await res.json(), isJson: true };
    } catch {
      return { data: null, isJson: true };
    }
  }
  try {
    const text = await res.text();
    return { data: { error: text }, isJson: false };
  } catch {
    return { data: null, isJson: false };
  }
}

