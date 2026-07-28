import { sanitizeHtml } from './sanitize-util';

/**
 * Pure, I/O-free render transforms applied to newsletter content at send time. Kept side-effect free
 * so they can be unit-tested in isolation (see newsletter-render.spec.ts). The send handler
 * (`lib/jobs/handlers/newsletter.handlers.ts`) and the test-email path
 * (`modules/newsletters/controller.ts`) both compose these before handing HTML to SendGrid.
 */

// The visual editor embeds its block model as a JSON comment. It must never ship in a sent email.
const BLOCK_DATA_COMMENT_RE = /<!--\s*PPLCRM_VISUAL_BLOCKS_DATA:[\s\S]*?-->/g;

// The editor's merge-field syntax: {FieldName} or {FieldName|fallback text}. Mirrors the pattern in
// the frontend visual-newsletter-editor so send-time substitution matches the editor's preview.
const MERGE_TOKEN_PATTERN = '\\{([a-zA-Z0-9_]+)(?:\\|([^}]*))?\\}';

// Marker attribute so preheader injection is idempotent across composed calls.
const PREHEADER_MARKER = 'data-pc-preheader';

export interface MergeToken {
  /** The literal token as it appears in the content, e.g. "{FirstName|there}". */
  token: string;
  /** The field name, e.g. "FirstName". */
  field: string;
  /** The fallback text after "|", or "" when none was given. */
  fallback: string;
}

export interface MergeRecipient {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/** Escapes the characters that would break out of an HTML text/attribute context. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** True for absolute URLs (with a scheme) and protocol-relative (`//host`) URLs. */
function isAbsoluteUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** Removes the editor's block-model JSON comment(s) so they never ship in the sent email. */
export function stripEditorBlockData(html: string): string {
  return html.replace(BLOCK_DATA_COMMENT_RE, '');
}

/**
 * Rewrites relative `<img src>` values (e.g. "assets/newsletters/x.png") to absolute URLs against
 * baseUrl so they resolve in email clients, which have no notion of the app's origin. Absolute,
 * protocol-relative, `data:` and `cid:` URLs are left untouched.
 */
export function rewriteRelativeImageUrls(html: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi,
    (match, prefix: string, quote: string, url: string) => {
      const trimmed = url.trim();
      if (!trimmed || isAbsoluteUrl(trimmed)) return match;
      const path = trimmed.replace(/^\.?\/+/, '');
      return `${prefix}${quote}${base}/${path}${quote}`;
    },
  );
}

/**
 * Injects previewText as a hidden preheader block at the top of the body. Idempotent — if a
 * preheader has already been injected (marker present) or previewText is empty, returns html
 * unchanged. The preheader is what inboxes show next to the subject line.
 */
export function injectPreheader(html: string, previewText: string | null | undefined): string {
  const text = (previewText ?? '').trim();
  if (!text || html.includes(PREHEADER_MARKER)) return html;
  const preheader =
    `<div ${PREHEADER_MARKER} style="display:none;max-height:0;overflow:hidden;` +
    `mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0;">` +
    `${escapeHtml(text)}</div>`;
  const bodyMatch = html.match(/<body\b[^>]*>/i);
  if (bodyMatch) {
    const idx = html.indexOf(bodyMatch[0]) + bodyMatch[0].length;
    return html.slice(0, idx) + preheader + html.slice(idx);
  }
  return preheader + html;
}

/**
 * Composes the send-time HTML transforms: sanitize, strip block data, rewrite images,
 * inject preheader.
 *
 * SECURITY (finding M4): the sanitize step was missing, which made this path asymmetric
 * with the mailbox-compose path (modules/emails/controller.ts), where tenant HTML IS
 * sanitized. A compromised or malicious editor account could put arbitrary markup —
 * scripts, tracking beacons, credential-harvesting forms — into a newsletter and have it
 * sent from the tenant's own verified, DKIM-signed domain to its whole audience.
 *
 * Sanitizing before the other transforms means they only ever operate on markup that has
 * already survived the allow-list.
 */
export function renderNewsletterHtml(html: string, options: { baseUrl: string; previewText?: string | null }): string {
  let out = sanitizeHtml(html);
  out = stripEditorBlockData(out);
  out = rewriteRelativeImageUrls(out, options.baseUrl);
  out = injectPreheader(out, options.previewText);
  return out;
}

// Elements whose entire content is invisible to readers and must not leak into the text part.
const INVISIBLE_ELEMENT_RE = /<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi;

// The hidden preheader div injected by injectPreheader (escaped text only, never nested divs).
const PREHEADER_DIV_RE = new RegExp(`<div ${PREHEADER_MARKER}[^>]*>[\\s\\S]*?</div>`, 'gi');

/** Decodes the handful of HTML entities the editor/escaper emits into plain characters. */
function decodeBasicEntities(text: string): string {
  return (
    text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      // last, so "&amp;lt;" decodes to "&lt;" rather than "<"
      .replace(/&amp;/gi, '&')
  );
}

/**
 * Derives a readable text/plain part from newsletter HTML so every send is multipart/alternative
 * (an HTML-only body is a spam-filter signal). Block-level closers become line breaks, anchors keep
 * their destination as "text (url)", images collapse to their alt text, and everything else is
 * stripped. Not a general-purpose converter — tuned to the markup the block compiler emits.
 */
export function htmlToPlainText(html: string): string {
  let out = stripEditorBlockData(html);
  out = out.replace(INVISIBLE_ELEMENT_RE, '');
  out = out.replace(PREHEADER_DIV_RE, '');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/(?:p|div|h[1-6]|tr|table|ul|ol|blockquote)>/gi, '\n\n');
  out = out.replace(/<li\b[^>]*>/gi, '\n- ');
  out = out.replace(
    /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      const url = href.trim();
      if (!/^https?:\/\//i.test(url) || text === url) return text || url;
      return text ? `${text} (${url})` : url;
    },
  );
  out = out.replace(/<img\b[^>]*?\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, '$2');
  out = out.replace(/<[^>]+>/g, '');
  out = decodeBasicEntities(out);
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t\u00A0]+/g, ' ').trim())
    .join('\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Scans the given content strings for the distinct merge tokens they contain. */
export function extractMergeTokens(...contents: (string | null | undefined)[]): MergeToken[] {
  const re = new RegExp(MERGE_TOKEN_PATTERN, 'g');
  const byToken = new Map<string, MergeToken>();
  for (const content of contents) {
    if (!content) continue;
    for (const m of content.matchAll(re)) {
      const token = m[0];
      if (byToken.has(token)) continue;
      byToken.set(token, { token, field: m[1] ?? '', fallback: m[2] ?? '' });
    }
  }
  return [...byToken.values()];
}

/** Resolves a single merge field for a recipient. Returns null when the field is unknown or empty. */
function rawFieldValue(field: string, recipient: MergeRecipient): string | null {
  switch (field.toLowerCase()) {
    case 'firstname':
      return recipient.firstName ?? null;
    case 'lastname':
      return recipient.lastName ?? null;
    case 'name':
      return [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || null;
    case 'email':
      return recipient.email ?? null;
    case 'phone':
      return recipient.phone ?? null;
    default:
      return null; // unknown field — resolved via fallback below
  }
}

/**
 * Builds the SendGrid substitution map for one recipient: token -> resolved, HTML-escaped value.
 * A field with no value uses the token's "|fallback" text (or "" when none). Unknown fields also
 * fall back, so no raw "{Field}" ever ships to a recipient.
 */
export function resolveMergeSubstitutions(tokens: MergeToken[], recipient: MergeRecipient): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tokens) {
    const value = rawFieldValue(t.field, recipient);
    const resolved = value != null && value !== '' ? value : t.fallback;
    out[t.token] = escapeHtml(resolved);
  }
  return out;
}
