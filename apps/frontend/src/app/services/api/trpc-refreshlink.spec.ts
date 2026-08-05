import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshLink, silentRefresh } from './trpc-refreshlink';
import { registerSessionDiscard } from '../error.service';
import { TRPCClientError } from '@trpc/client';
import type { Operation } from '@trpc/client';
import type { Observer } from '@trpc/server/observable';

const expiredToken = 'header.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })) + '.signature';
const validToken = 'header.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120 })) + '.signature';

describe('trpc-refreshlink', () => {
  let mockTokenSvc: any;
  let mockRouter: any;
  let currentAuthToken: string;
  let fetchCount: number;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    currentAuthToken = expiredToken;
    fetchCount = 0;

    mockTokenSvc = {
      getAuthToken: vi.fn().mockImplementation(() => currentAuthToken),
      setAuthToken: vi.fn().mockImplementation((token) => {
        currentAuthToken = token;
      }),
      clearAll: vi.fn(),
    };

    mockRouter = {
      navigate: vi.fn(),
      url: '/current-url',
    };

    globalThis.fetch = vi.fn().mockImplementation(async (_url, _init) => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({
          result: {
            data: {
              json: {
                // Renew now returns only the access token; the refresh token is an HttpOnly cookie.
                auth_token: validToken,
              },
            },
          },
        }),
      };
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should coalesce parallel token refreshes into a single fetch request', async () => {
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    const executeLink = () => {
      return new Promise((resolve, reject) => {
        const mockOp: Operation = {
          id: 1,
          type: 'query',
          path: 'testPath',
          input: {},
          context: {},
          signal: new AbortController().signal,
        };
        const mockNext = vi.fn().mockReturnValue({
          subscribe: (observer: Observer<any, any>) => {
            observer.next('result');
            observer.complete();
            return { unsubscribe: vi.fn() };
          },
        });

        link({ op: mockOp, next: mockNext }).subscribe({
          next: resolve,
          error: reject,
        });
      });
    };

    // Execute three requests in parallel
    await Promise.all([executeLink(), executeLink(), executeLink()]);

    // Check that we only fetched once
    expect(fetchCount).toBe(1);

    // Check that the refreshed access token was stored in memory
    expect(mockTokenSvc.setAuthToken).toHaveBeenCalledWith(validToken);

    // Subsequent call should not fetch because currentAuthToken is now updated (not expired)
    await executeLink();
    expect(fetchCount).toBe(1); // Still 1
  });

  it('should refresh and retry once when the server rejects a seemingly-valid token', async () => {
    // The token looks fine client-side, but its session was rotated away by another tab.
    currentAuthToken = validToken;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    let attempts = 0;
    const mockNext = vi.fn().mockImplementation(() => ({
      subscribe: (observer: Observer<any, any>) => {
        attempts++;
        if (attempts === 1) {
          observer.error(unauthorizedClientError());
        } else {
          observer.next('result');
          observer.complete();
        }
        return { unsubscribe: vi.fn() };
      },
    }));

    const result = await new Promise((resolve, reject) => {
      link({ op: makeOp('persons.getAll'), next: mockNext }).subscribe({ next: resolve, error: reject });
    });

    expect(result).toBe('result');
    expect(attempts).toBe(2); // original call + one retry
    expect(fetchCount).toBe(1); // exactly one refresh round-trip
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should clear tokens and redirect to /signin when the retry refresh fails', async () => {
    currentAuthToken = validToken;
    // The refresh cookie's session is gone too (real sign-out / revocation) — renew returns 401.
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        error: { json: { message: 'UNAUTHORIZED', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } } },
      }),
    })) as any;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    const mockNext = vi.fn().mockReturnValue({
      subscribe: (observer: Observer<any, any>) => {
        observer.error(unauthorizedClientError());
        return { unsubscribe: vi.fn() };
      },
    });

    await expect(
      new Promise((resolve, reject) => {
        link({ op: makeOp('persons.getAll'), next: mockNext }).subscribe({ next: resolve, error: reject });
      }),
    ).rejects.toBeInstanceOf(TRPCClientError);

    expect(mockNext).toHaveBeenCalledTimes(1); // no retry when the refresh fails
    expect(mockTokenSvc.clearAll).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/current-url' } });
  });

  it('should forward a guest request untouched without probing the refresh endpoint', async () => {
    currentAuthToken = '';
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
    const mockNext = successNext();

    const result = await runLink(link, makeOp('persons.getAll'), mockNext);

    expect(result).toBe('result');
    expect(fetchCount).toBe(0);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should treat a token inside the 30s expiry leeway as expired and refresh pre-flight', async () => {
    // exp is 10s away — technically unexpired, but inside the 30s leeway window.
    currentAuthToken = makeToken(Math.floor(Date.now() / 1000) + 10);
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    const result = await runLink(link, makeOp('persons.getAll'), successNext());

    expect(result).toBe('result');
    expect(fetchCount).toBe(1);
    expect(mockTokenSvc.setAuthToken).toHaveBeenCalledWith(validToken);
  });

  it('should not refresh a token comfortably outside the leeway window', async () => {
    currentAuthToken = makeToken(Math.floor(Date.now() / 1000) + 120);
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    const result = await runLink(link, makeOp('persons.getAll'), successNext());

    expect(result).toBe('result');
    expect(fetchCount).toBe(0);
  });

  it('should clear tokens, redirect, and never run the call when the pre-flight refresh fails', async () => {
    currentAuthToken = expiredToken;
    globalThis.fetch = failingRenewFetch();
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
    const mockNext = successNext();

    await expect(runLink(link, makeOp('persons.getAll'), mockNext)).rejects.toBeInstanceOf(TRPCClientError);

    expect(mockNext).not.toHaveBeenCalled(); // the original call never went out
    expect(mockTokenSvc.clearAll).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/current-url' } });
  });

  it('should wrap a non-TRPC refresh failure into a TRPCClientError for the observer', async () => {
    currentAuthToken = expiredToken;
    mockTokenSvc.setAuthToken.mockImplementation((): void => {
      throw new Error('storage exploded');
    });
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    await expect(runLink(link, makeOp('persons.getAll'), successNext())).rejects.toBeInstanceOf(TRPCClientError);
    // A storage hiccup is not proof the session is gone — no sign-out.
    expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should keep tokens and stay put when the pre-flight refresh dies on the network (backend down)', async () => {
    currentAuthToken = expiredToken;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as any;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
    const mockNext = successNext();

    await expect(runLink(link, makeOp('persons.getAll'), mockNext)).rejects.toBeInstanceOf(TRPCClientError);

    expect(mockNext).not.toHaveBeenCalled(); // the original call never went out
    // The backend said nothing about the session — the user must NOT be signed out.
    expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should keep tokens when the post-UNAUTHORIZED retry refresh dies on the network', async () => {
    currentAuthToken = validToken;
    // The call 401s (session rotated away), but the refresh round-trip can't reach the backend.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as any;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
    const mockNext = errorNext(unauthorizedClientError());

    await expect(runLink(link, makeOp('persons.getAll'), mockNext)).rejects.toBeInstanceOf(TRPCClientError);

    expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should clear tokens but NOT redirect when the refresh fails on a public route', async () => {
    currentAuthToken = expiredToken;
    mockRouter.url = '/f/some-form';
    globalThis.fetch = failingRenewFetch();
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    await expect(runLink(link, makeOp('persons.getAll'), successNext())).rejects.toBeInstanceOf(TRPCClientError);

    expect(mockTokenSvc.clearAll).toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should never transparently retry a failed sign-in (rate-limit safety)', async () => {
    currentAuthToken = validToken;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    for (const path of ['signIn', 'auth.signIn']) {
      const mockNext = errorNext(unauthorizedClientError());
      await expect(runLink(link, makeOp(path), mockNext)).rejects.toBeInstanceOf(TRPCClientError);
      expect(mockNext).toHaveBeenCalledTimes(1);
    }
    expect(fetchCount).toBe(0); // no refresh attempted for either sign-in path
  });

  it('should propagate a non-UNAUTHORIZED error immediately without refreshing', async () => {
    currentAuthToken = validToken;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
    const badRequest = TRPCClientError.from({
      error: { message: 'Name is required', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } },
    } as any);
    const mockNext = errorNext(badRequest);

    await expect(runLink(link, makeOp('persons.update'), mockNext)).rejects.toBe(badRequest);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(fetchCount).toBe(0);
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should parse a base64url-encoded unpadded JWT payload (-/_ alphabet)', async () => {
    // '??????' guarantees '/' chars and stripping guarantees no padding, so this
    // token is undecodable by plain atob without the base64url conversion.
    const payloadJson = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, blob: '??????>>>' });
    const b64url = btoa(payloadJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(b64url).toMatch(/[-_]/); // the fixture must actually exercise the conversion
    currentAuthToken = `header.${b64url}.sig`;
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    const result = await runLink(link, makeOp('persons.getAll'), successNext());

    expect(result).toBe('result');
    expect(fetchCount).toBe(0); // exp parsed successfully → no refresh
  });

  it('should treat an unparseable token as expired and refresh it', async () => {
    currentAuthToken = 'not.a.jwt';
    const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

    const result = await runLink(link, makeOp('persons.getAll'), successNext());

    expect(result).toBe('result');
    expect(fetchCount).toBe(1);
    expect(mockTokenSvc.setAuthToken).toHaveBeenCalledWith(validToken);
  });

  describe('session discard on refresh failure (REVIEW5 T1-4)', () => {
    // AuthService cannot be reached from here (it sits above this module in the dependency
    // graph), so the 401 path clears the stale signed-in user through the registered
    // `discardSignedInUser` hook instead. Pin that it fires exactly when the refresh endpoint
    // itself proves the session is gone, and not for failures that say nothing about the session.
    let discardSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      discardSpy = vi.fn();
      registerSessionDiscard(discardSpy);
    });

    it('clears the stale signed-in user when the refresh endpoint answers UNAUTHORIZED (pre-flight)', async () => {
      currentAuthToken = expiredToken;
      globalThis.fetch = failingRenewFetch();
      const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

      await expect(runLink(link, makeOp('persons.getAll'), successNext())).rejects.toBeInstanceOf(TRPCClientError);

      expect(discardSpy).toHaveBeenCalledTimes(1);
    });

    it('clears the stale signed-in user when the post-UNAUTHORIZED retry refresh itself 401s', async () => {
      currentAuthToken = validToken;
      globalThis.fetch = failingRenewFetch();
      const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
      const mockNext = errorNext(unauthorizedClientError());

      await expect(runLink(link, makeOp('persons.getAll'), mockNext)).rejects.toBeInstanceOf(TRPCClientError);

      expect(discardSpy).toHaveBeenCalledTimes(1);
    });

    it('still clears the stale signed-in user on a public route, even though it does not redirect', async () => {
      currentAuthToken = expiredToken;
      mockRouter.url = '/f/some-form';
      globalThis.fetch = failingRenewFetch();
      const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

      await expect(runLink(link, makeOp('persons.getAll'), successNext())).rejects.toBeInstanceOf(TRPCClientError);

      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(discardSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT clear the signed-in user when the refresh dies on the network (outage, not proof the session is gone)', async () => {
      currentAuthToken = expiredToken;
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as any;
      const link = refreshLink(mockTokenSvc, mockRouter)({} as any);

      await expect(runLink(link, makeOp('persons.getAll'), successNext())).rejects.toBeInstanceOf(TRPCClientError);

      expect(discardSpy).not.toHaveBeenCalled();
    });

    it('does NOT clear the signed-in user for a non-UNAUTHORIZED error that never touches the refresh path', async () => {
      currentAuthToken = validToken;
      const link = refreshLink(mockTokenSvc, mockRouter)({} as any);
      const badRequest = TRPCClientError.from({
        error: { message: 'Name is required', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } },
      } as any);

      await expect(runLink(link, makeOp('persons.update'), errorNext(badRequest))).rejects.toBe(badRequest);

      expect(discardSpy).not.toHaveBeenCalled();
    });
  });

  describe('silentRefresh', () => {
    it('returns the new token on success', async () => {
      await expect(silentRefresh(mockTokenSvc)).resolves.toBe(validToken);
      expect(mockTokenSvc.setAuthToken).toHaveBeenCalledWith(validToken);
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    });

    it('returns null and clears tokens for a genuine guest — never throws', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

      await expect(silentRefresh(mockTokenSvc)).resolves.toBeNull();
      expect(mockTokenSvc.clearAll).toHaveBeenCalled();
    });
  });
});

function makeOp(path: string): Operation {
  return { id: 1, type: 'query', path, input: {}, context: {}, signal: new AbortController().signal };
}

function makeToken(exp: number): string {
  return 'header.' + btoa(JSON.stringify({ exp })) + '.signature';
}

function runLink(link: any, op: Operation, next: any): Promise<unknown> {
  return new Promise((resolve, reject) => {
    link({ op, next }).subscribe({ next: resolve, error: reject });
  });
}

function successNext() {
  return vi.fn().mockReturnValue({
    subscribe: (observer: Observer<any, any>) => {
      observer.next('result');
      observer.complete();
      return { unsubscribe: vi.fn() };
    },
  });
}

function errorNext(err: unknown) {
  return vi.fn().mockReturnValue({
    subscribe: (observer: Observer<any, any>) => {
      observer.error(err as any);
      return { unsubscribe: vi.fn() };
    },
  });
}

/** A renew endpoint whose session is gone — every refresh round-trip 401s. */
function failingRenewFetch(): typeof globalThis.fetch {
  return vi.fn().mockImplementation(async () => ({
    ok: false,
    status: 401,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({
      error: { json: { message: 'UNAUTHORIZED', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } } },
    }),
  })) as any;
}

function unauthorizedClientError(): TRPCClientError<any> {
  return TRPCClientError.from({
    error: { message: 'UNAUTHORIZED', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } },
  } as any);
}
