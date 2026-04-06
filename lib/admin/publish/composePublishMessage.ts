/** Max length for stored announcement / pickup post body after composition. */
export const PUBLISH_MESSAGE_MAX_CHARS = 20_000;
/** Optional short headline prepended to the body. */
export const PUBLISH_LABEL_MAX_CHARS = 200;

export type ComposeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Optional label is stored as the first line of the published text so we do not require new DB columns.
 * Format: "Label\n\nmessage" when label is non-empty.
 */
export function composePublishMessage(message: string, label?: string | null): ComposeResult {
  const body = String(message || "").trim();
  if (!body) {
    return { ok: false, error: "Message is required." };
  }
  if (body.length > PUBLISH_MESSAGE_MAX_CHARS) {
    return { ok: false, error: `Message is too long (max ${PUBLISH_MESSAGE_MAX_CHARS} characters).` };
  }

  const head = String(label ?? "").trim();
  if (head.length > PUBLISH_LABEL_MAX_CHARS) {
    return { ok: false, error: `Title is too long (max ${PUBLISH_LABEL_MAX_CHARS} characters).` };
  }

  const text = head ? `${head}\n\n${body}` : body;
  if (text.length > PUBLISH_MESSAGE_MAX_CHARS) {
    return { ok: false, error: `Combined title and message are too long (max ${PUBLISH_MESSAGE_MAX_CHARS} characters).` };
  }

  return { ok: true, text };
}
