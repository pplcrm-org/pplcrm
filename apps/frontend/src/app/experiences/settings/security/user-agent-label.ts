/**
 * Turn the raw `User-Agent` header stored with a session into something a person can recognise,
 * such as "Chrome on macOS".
 *
 * This is deliberately a rough match, not a parser. The goal is only to help someone spot the
 * device they do not recognise; when we cannot tell, we say so rather than guess. Nothing depends
 * on the answer being right, so no user-agent database is worth pulling in for it.
 */

/** Order matters: every Chromium browser also claims "Chrome", and almost everything claims "Safari". */
const BROWSERS: { label: string; test: RegExp }[] = [
  { label: 'Edge', test: /\bEdgi?A?\/|\bEdge\//i },
  { label: 'Opera', test: /\bOPR\/|\bOpera\//i },
  { label: 'Samsung Internet', test: /SamsungBrowser\//i },
  { label: 'Firefox', test: /\bFirefox\/|\bFxiOS\//i },
  { label: 'Chrome', test: /\bChrome\/|\bCriOS\//i },
  { label: 'Safari', test: /\bSafari\//i },
];

/** Also order-sensitive: an iPhone user agent contains "Mac OS X", and Android contains "Linux". */
const PLATFORMS: { label: string; test: RegExp }[] = [
  { label: 'iPhone', test: /iPhone/i },
  { label: 'iPad', test: /iPad/i },
  { label: 'Android', test: /Android/i },
  { label: 'Windows', test: /Windows NT/i },
  { label: 'macOS', test: /Mac OS X|Macintosh/i },
  { label: 'Linux', test: /Linux|X11/i },
];

const UNKNOWN_DEVICE = 'Unrecognised browser';

export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return UNKNOWN_DEVICE;

  const browser = BROWSERS.find((b) => b.test.test(ua))?.label;
  const platform = PLATFORMS.find((p) => p.test.test(ua))?.label;

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return UNKNOWN_DEVICE;
}
