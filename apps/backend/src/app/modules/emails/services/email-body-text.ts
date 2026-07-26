/**
 * Body storage helpers.
 *
 * An HTML email is mostly not text: markup, inline CSS, tracking pixels and base64 noise typically
 * account for ~90% of the bytes. We keep the cheap, useful part (a plain-text extract) in Postgres
 * where it can be indexed and searched, and push the HTML to blob storage where bytes are cheap.
 */

/**
 * Bodies at or below this size stay inline in `email_bodies.body_html`. A two-line reply is not
 * worth a blob round-trip on every open.
 */
export const INLINE_BODY_MAX_BYTES = 4 * 1024;

/**
 * Upper bound on the stored text extract. Long enough for any real message; a guard against a
 * pathological body bloating the row and the search index.
 */
export const BODY_TEXT_MAX_CHARS = 100_000;

/**
 * Reduce sanitized HTML to searchable plain text.
 *
 * Input is expected to have been through `sanitizeHtml` already, so scripts are gone — but style
 * and head content can survive sanitization and would otherwise pollute the search index with CSS
 * selectors, so they are stripped explicitly here.
 */
export function extractBodyText(html: string): string {
  const text = html
    // Drop elements whose *content* is not prose.
    .replace(/<(script|style|head|title|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Treat block boundaries as whitespace so words don't run together.
    .replace(/<\/?(p|div|br|tr|li|h[1-6]|blockquote|table)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    // Decode the handful of entities that actually matter for search.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > BODY_TEXT_MAX_CHARS ? text.slice(0, BODY_TEXT_MAX_CHARS) : text;
}
