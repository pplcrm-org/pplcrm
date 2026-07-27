import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertSafeOutboundUrl, isBlockedAddress, resolveSafeOutboundHost } from './outbound-url-guard';

vi.mock('dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'dns/promises';

/**
 * SECURITY REGRESSION (H1) — the Zapier webhook target was validated only as
 * `z.string().url()`, and the backend POSTs to it from inside the Azure Container Apps
 * network. Any authenticated user could aim it at the cloud metadata endpoint or a
 * loopback port and use the logged status code as a scanning oracle.
 */
describe('assertSafeOutboundUrl', () => {
  it('accepts an ordinary https webhook URL', () => {
    expect(() => assertSafeOutboundUrl('https://hooks.zapier.com/hooks/catch/123/abc')).not.toThrow();
  });

  it('rejects non-https schemes', () => {
    for (const url of ['http://example.com/hook', 'file:///etc/passwd', 'gopher://example.com']) {
      expect(() => assertSafeOutboundUrl(url)).toThrow(/https/i);
    }
  });

  it('rejects literal internal addresses', () => {
    for (const host of [
      '169.254.169.254', // Azure/AWS instance metadata
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.5',
      '172.16.0.1',
      '[::1]',
    ]) {
      expect(() => assertSafeOutboundUrl(`https://${host}/hook`)).toThrow(/private or internal/i);
    }
  });

  it('rejects embedded credentials', () => {
    expect(() => assertSafeOutboundUrl('https://user:pass@example.com/hook')).toThrow(/username or password/i);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertSafeOutboundUrl('not a url')).toThrow(/valid URL/i);
  });
});

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['169.254.169.254', true],
    ['10.0.0.1', true],
    ['172.20.1.1', true],
    ['192.168.1.1', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['2606:4700:4700::1111', false],
  ])('%s -> blocked=%s', (ip, blocked) => {
    expect(isBlockedAddress(ip)).toBe(blocked);
  });

  it('blocks anything that is not an IP', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
  });
});

describe('resolveSafeOutboundHost', () => {
  afterEach(() => vi.resetAllMocks());

  it('allows a hostname that resolves publicly', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    await expect(resolveSafeOutboundHost('https://hooks.zapier.com/x')).resolves.toBeUndefined();
  });

  // The whole point of re-resolving at request time: a name that was public when the
  // tenant subscribed can be re-pointed at loopback afterwards (DNS rebinding).
  it('rejects a hostname that now resolves to an internal address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(resolveSafeOutboundHost('https://rebind.example.com/x')).rejects.toThrow(/private or internal/i);
  });

  it('rejects when any resolved address is internal, not just the first', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as never);
    await expect(resolveSafeOutboundHost('https://mixed.example.com/x')).rejects.toThrow(/private or internal/i);
  });

  it('rejects when the hostname does not resolve', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
    await expect(resolveSafeOutboundHost('https://nope.example.com/x')).rejects.toThrow(/Could not resolve/i);
  });
});
