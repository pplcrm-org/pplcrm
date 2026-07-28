import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanionAccessPayload } from '@common';

import { CompanionSessionService } from './companion-api';

/**
 * getAccess transient-vs-dead mapping. The backend answers 200 for every
 * resolved outcome (including `{ state: 'dead' }`), so only a 200 body may
 * declare a link dead; non-ok responses and network throws are transient
 * failures on a phone with poor signal and must surface as 'unreachable'.
 */

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('CompanionSessionService.getAccess', () => {
  let service: CompanionSessionService;
  let fetchMock: FetchMock;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    service = new CompanionSessionService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes a 200 payload through untouched', async () => {
    const payload: CompanionAccessPayload = { state: 'need_verification', contacts: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    await expect(service.getAccess('turf', 'tok-12345678')).resolves.toEqual(payload);
  });

  it('honors an authoritative 200 dead state', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ state: 'dead' }));
    await expect(service.getAccess('turf', 'tok-12345678')).resolves.toEqual({ state: 'dead' });
  });

  it('maps a transient 5xx (edge deploy, backend blip) to unreachable, not dead', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'upstream unavailable' }, 503));
    await expect(service.getAccess('route', 'tok-12345678')).resolves.toEqual({ state: 'unreachable' });
  });

  it('maps a 429 rate limit to unreachable, not dead', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'slow down' }, 429));
    await expect(service.getAccess('turf', 'tok-12345678')).resolves.toEqual({ state: 'unreachable' });
  });

  it('maps a network throw to unreachable instead of rejecting', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    await expect(service.getAccess('turf', 'tok-12345678')).resolves.toEqual({ state: 'unreachable' });
  });

  it('sends no token for the session kind — the session header is the whole request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ state: 'ready' }));
    await service.getAccess('session', null);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('kind=session');
    expect(url).not.toContain('token=');
  });
});

describe('CompanionSessionService join + approve', () => {
  let service: CompanionSessionService;
  let fetchMock: FetchMock;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    service = new CompanionSessionService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the one-shot claim a QR join verifies with', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ masked: 'p•••@example.com', channel: 'email', claim: 'claim-123' }));
    const result = await service.joinStart({ code: 'MAPLE4KQ', first_name: 'Priya', email: 'priya@example.com' });
    expect(result.claim).toBe('claim-123');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/companion/join/start');
  });

  it('surfaces the uniform refusal rather than inventing its own message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'That code is not accepting new volunteers.' }, 404));
    await expect(
      service.joinStart({ code: 'NOTACODE', first_name: 'Priya', email: 'priya@example.com' }),
    ).rejects.toThrow(/not accepting new volunteers/);
  });

  it('treats an unreachable approval link as dead rather than throwing at the admin', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 500));
    await expect(service.getApproval('tok')).resolves.toEqual({ state: 'dead' });
  });
});
