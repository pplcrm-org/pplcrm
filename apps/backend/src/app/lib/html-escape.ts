/**
 * HTML escaping for server-rendered pages and outbound email.
 *
 * SECURITY (finding C5): transactional email templates interpolated tenant-controlled
 * strings — event names, form names, a user's own display name — straight into HTML with
 * no escaping, and those messages go out over the platform's own DKIM-signed domain. A
 * display name of `<a href="https://evil/">Click to activate</a>` rendered as a live link
 * inside a legitimate pplCRM invitation.
 *
 * Prefer the {@link html} tagged template over calling {@link escapeHtml} by hand: it
 * escapes by default, so a new interpolation is safe unless someone explicitly opts out.
 * Reaching for {@link trustedHtml} should feel like a decision.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape every character with meaning in HTML text or a quoted attribute. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

/** Marker for a string that is already valid, intentional HTML. */
export class TrustedHtml {
  constructor(public readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/**
 * Mark a string as intentional markup so {@link html} interpolates it verbatim.
 *
 * Only ever pass markup this codebase constructed. Never pass user input, and never pass
 * a value that merely "looks safe" — that judgement is what this module exists to remove.
 */
export function trustedHtml(value: string): TrustedHtml {
  return new TrustedHtml(value);
}

/** True when a value came from {@link trustedHtml}. */
function isTrusted(value: unknown): value is TrustedHtml {
  return value instanceof TrustedHtml;
}

/**
 * Tagged template that escapes every interpolation.
 *
 *   html`<p>Hi ${name}</p>`                      // name is escaped
 *   html`<div>${trustedHtml(builtMarkup)}</div>` // opted out, deliberately
 *
 * Arrays are joined with no separator, so a list of trusted fragments composes.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): TrustedHtml {
  const out: string[] = [strings[0] ?? ''];
  for (let i = 0; i < values.length; i++) {
    out.push(render(values[i]), strings[i + 1] ?? '');
  }
  return trustedHtml(out.join(''));
}

function render(value: unknown): string {
  if (isTrusted(value)) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/**
 * Join fragments with a separator, escaping any that are not already trusted.
 *
 *   joinHtml(lines, trustedHtml('<br>'))
 */
export function joinHtml(parts: readonly unknown[], separator: TrustedHtml | string): TrustedHtml {
  const sep = isTrusted(separator) ? separator.value : escapeHtml(separator);
  return trustedHtml(
    parts
      .filter((p) => p !== null && p !== undefined && p !== '')
      .map(render)
      .join(sep),
  );
}
