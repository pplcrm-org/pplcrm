import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { BadRequestError } from '../errors/app-errors';

/**
 * Guard for URLs a tenant supplies that the backend will then request itself
 * (finding H1: the Zapier webhook target).
 *
 * The backend runs inside Azure Container Apps, so a request it makes originates from
 * inside the network perimeter. A tenant-supplied `http://169.254.169.254/metadata/instance`
 * or `http://127.0.0.1:3000/…` therefore reaches things no external client can, and even a
 * blind request leaks information through its status code and timing.
 *
 * Two checks, because either alone is bypassable:
 *
 *  - {@link assertSafeOutboundUrl} at configuration time, for a fast, clear error.
 *  - {@link resolveSafeOutboundHost} again at REQUEST time, because DNS is not stable:
 *    a hostname that resolved publicly when subscribed can be re-pointed at 127.0.0.1
 *    afterwards (DNS rebinding). Checking only on save is checking the wrong moment.
 */

/** Only ever fetch over TLS — plaintext to an arbitrary host also leaks the payload. */
const ALLOWED_PROTOCOLS = new Set(['https:']);

/**
 * Address ranges that are never a legitimate webhook destination: loopback, link-local
 * (incl. the cloud metadata endpoint at 169.254.169.254), private RFC 1918 space,
 * carrier-grade NAT, and IPv6 loopback/link-local/unique-local.
 */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? '';
  if (addr === '::' || addr === '::1') return true; // unspecified / loopback
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  if (addr.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:127.0.0.1) — judge by the embedded IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
  return false;
}

/**
 * Strip the brackets `new URL()` keeps around an IPv6 host.
 *
 * `new URL('https://[::1]/').hostname` is `'[::1]'`, which `isIP()` reports as 0 — so
 * without this a bracketed literal reads as "a hostname, check it at DNS time" and walks
 * straight past the configuration-time check.
 */
function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** True when this literal IP must never be fetched. */
export function isBlockedAddress(ip: string): boolean {
  const addr = unbracket(ip);
  const version = isIP(addr);
  if (version === 4) return isBlockedIpv4(addr);
  if (version === 6) return isBlockedIpv6(addr);
  return true; // not an IP at all — caller should not have got here
}

/** True when the URL host is an IP literal (bracketed IPv6 included), not a name. */
function isIpLiteral(host: string): boolean {
  return isIP(unbracket(host)) !== 0;
}

/**
 * Validate a tenant-supplied outbound URL at configuration time.
 *
 * Throws BadRequestError with a message safe to show the user. Does NOT resolve DNS —
 * call {@link resolveSafeOutboundHost} before actually making the request.
 */
export function assertSafeOutboundUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestError('Enter a valid URL.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BadRequestError('The URL must start with https://');
  }
  // Credentials in a webhook URL end up in logs and serve no purpose here.
  if (url.username || url.password) {
    throw new BadRequestError('The URL must not contain a username or password.');
  }
  // A literal private address is rejected outright; a hostname is checked at request time.
  if (isIpLiteral(url.hostname) && isBlockedAddress(url.hostname)) {
    throw new BadRequestError('That URL points at a private or internal address.');
  }
  return url;
}

export class BlockedOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedOutboundUrlError';
  }
}

/**
 * Re-check a URL immediately before fetching it, resolving DNS and rejecting every
 * address the hostname maps to that is internal.
 *
 * Defeats DNS rebinding: the subscribe-time check cannot bind a name to an address
 * forever, so the address is re-derived here, at the moment it matters.
 */
export async function resolveSafeOutboundHost(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = assertSafeOutboundUrl(rawUrl);
  } catch (err) {
    throw new BlockedOutboundUrlError(err instanceof Error ? err.message : 'Unsafe URL');
  }

  if (isIpLiteral(url.hostname)) return; // already validated as a literal above

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BlockedOutboundUrlError(`Could not resolve ${url.hostname}`);
  }

  if (addresses.length === 0) {
    throw new BlockedOutboundUrlError(`Could not resolve ${url.hostname}`);
  }
  // Every resolved address must be public — a name that returns both a public and a
  // private address is still a rebinding vector.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedOutboundUrlError(`${url.hostname} resolves to a private or internal address`);
    }
  }
}
