import { describe, it, expect } from 'vitest';
import { escapeHtml, html, joinHtml, trustedHtml } from './html-escape';

/**
 * SECURITY REGRESSION (C5) — transactional email templates interpolated tenant-controlled
 * strings into HTML unescaped, and those messages go out over pplCRM's own DKIM-signed
 * domain. A display name of `<a href="https://evil/">Click to activate</a>` rendered as a
 * live link inside a legitimate invitation.
 */
describe('escapeHtml', () => {
  it('escapes every character with meaning in HTML', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;');
  });

  it('renders null and undefined as empty, not as text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('html tagged template', () => {
  it('escapes interpolations by default', () => {
    const name = '<img src=x onerror=alert(1)>';
    expect(String(html`<p>Hi ${name}</p>`)).toBe('<p>Hi &lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('neutralizes a payload that would break out of an attribute', () => {
    const evil = '" onmouseover="alert(1)';
    expect(String(html`<a title="${evil}">x</a>`)).not.toContain('onmouseover="alert');
  });

  // The real-world exploit from the finding.
  it('renders an injected anchor as inert text', () => {
    const inviter = '<a href="https://evil.tld">Click to activate</a>';
    const out = String(html`<p>You've been invited by <strong>${inviter}</strong></p>`);
    expect(out).not.toContain('<a href');
    expect(out).toContain('&lt;a href=');
  });

  it('keeps the static markup intact', () => {
    expect(String(html`<p>plain</p>`)).toBe('<p>plain</p>');
  });

  it('interpolates trusted fragments verbatim', () => {
    const fragment = trustedHtml('<em>ok</em>');
    expect(String(html`<p>${fragment}</p>`)).toBe('<p><em>ok</em></p>');
  });

  it('composes nested html templates without double-escaping', () => {
    const inner = html`<em>${'a&b'}</em>`;
    expect(String(html`<p>${inner}</p>`)).toBe('<p><em>a&amp;b</em></p>');
  });

  it('joins arrays, escaping untrusted members', () => {
    expect(String(html`<p>${['<a>', trustedHtml('<b>')]}</p>`)).toBe('<p>&lt;a&gt;<b></p>');
  });
});

describe('joinHtml', () => {
  it('escapes untrusted parts and drops empties', () => {
    const out = String(joinHtml(['<a>', '', 'b'], trustedHtml('<br>')));
    expect(out).toBe('&lt;a&gt;<br>b');
  });

  it('escapes a string separator', () => {
    expect(String(joinHtml(['a', 'b'], ' & '))).toBe('a &amp; b');
  });
});
