import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TRPCClientError } from '@trpc/client';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSendServerError } from '../../../../../libs/common/src';
import { ApiError } from './api/api-error';
import { TokenService } from './api/token-service';
import { SERVER_UNREACHABLE_MESSAGE } from './api/user-message';
import { ErrorService } from './error.service';

const FALLBACK = 'Something went wrong, please try again';

function unauthorizedClientError(): TRPCClientError<any> {
  return TRPCClientError.from({
    error: { message: 'UNAUTHORIZED', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } },
  } as any);
}

function badRequestClientError(message = 'Name is required'): TRPCClientError<any> {
  return TRPCClientError.from({
    error: { message, code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } },
  } as any);
}

describe('ErrorService', () => {
  let service: ErrorService;
  let mockAlerts: { showError: ReturnType<typeof vi.fn>; muteErrorsFor: ReturnType<typeof vi.fn> };
  let mockRouter: { url: string; navigate: ReturnType<typeof vi.fn> };
  let mockTokenSvc: { clearAll: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    // The 3s redirect de-dupe compares against lastRedirect = 0, so the mocked
    // clock must start beyond 3000ms or the very first redirect is suppressed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);

    mockAlerts = { showError: vi.fn(), muteErrorsFor: vi.fn() };
    mockRouter = { url: '/persons/42', navigate: vi.fn() };
    mockTokenSvc = { clearAll: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        ErrorService,
        { provide: AlertService, useValue: mockAlerts },
        { provide: Router, useValue: mockRouter },
        { provide: TokenService, useValue: mockTokenSvc },
      ],
    });

    service = TestBed.inject(ErrorService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('JSendServerError', () => {
    it('shows the server message for a non-401 error and stays put', () => {
      service.handle(new JSendServerError('Upstream unavailable', undefined, 502));

      expect(mockAlerts.showError).toHaveBeenCalledWith('Upstream unavailable');
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    });

    it('signs the user out on a 401: clears tokens, redirects with returnUrl, no toast', () => {
      service.handle(new JSendServerError('Unauthorized', undefined, 401));

      expect(mockTokenSvc.clearAll).toHaveBeenCalledTimes(1);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/persons/42' } });
      expect(mockAlerts.showError).not.toHaveBeenCalled();
      // Mute the misleading "Failed to load …" toasts the other failing queries would raise.
      expect(mockAlerts.muteErrorsFor).toHaveBeenCalledTimes(1);
    });
  });

  describe('TRPCClientError', () => {
    it('redirects to sign-in on UNAUTHORIZED without a toast', () => {
      service.handle(unauthorizedClientError());

      expect(mockTokenSvc.clearAll).toHaveBeenCalledTimes(1);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/persons/42' } });
      expect(mockAlerts.showError).not.toHaveBeenCalled();
    });

    it('shows the error message for any non-auth code', () => {
      service.handle(badRequestClientError('Name is required'));

      expect(mockAlerts.showError).toHaveBeenCalledWith('Name is required');
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    });

    it('translates a data-less TRPCClientError (backend unreachable) into the outage message — no sign-out', () => {
      service.handle(new TRPCClientError('Failed to fetch'));

      expect(mockAlerts.showError).toHaveBeenCalledWith(SERVER_UNREACHABLE_MESSAGE);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    });
  });

  describe('ApiError', () => {
    it('redirects when the wrapped original error is UNAUTHORIZED', () => {
      service.handle(new ApiError('Failed to load persons', unauthorizedClientError()));

      expect(mockTokenSvc.clearAll).toHaveBeenCalledTimes(1);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/persons/42' } });
      expect(mockAlerts.showError).not.toHaveBeenCalled();
    });

    it("shows the wrapper's message (not the inner one) for a wrapped non-auth error", () => {
      service.handle(new ApiError('Could not save your changes', badRequestClientError('inner detail')));

      expect(mockAlerts.showError).toHaveBeenCalledWith('Could not save your changes');
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('shows the message of a plain ApiError with no original error', () => {
      service.handle(new ApiError('Export failed'));

      expect(mockAlerts.showError).toHaveBeenCalledWith('Export failed');
    });

    it('shows the outage message when the wrapped original error is a network-level failure', () => {
      service.handle(new ApiError('Failed to load persons', new TRPCClientError('Failed to fetch')));

      expect(mockAlerts.showError).toHaveBeenCalledWith(SERVER_UNREACHABLE_MESSAGE);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    });
  });

  describe('unknown errors', () => {
    it('never leaks internals: a TypeError shows the generic fallback', () => {
      service.handle(new TypeError("Cannot read properties of undefined (reading 'id')"));

      expect(mockAlerts.showError).toHaveBeenCalledWith(FALLBACK);
    });

    it('shows app-authored copy from a plain Error', () => {
      service.handle(new Error('Pick a campaign first'));

      expect(mockAlerts.showError).toHaveBeenCalledWith('Pick a campaign first');
    });
  });

  describe('401 redirect de-dupe', () => {
    it('suppresses a second redirect within 3s and stays silent — no duplicate toast', () => {
      service.handle(new JSendServerError('Unauthorized', undefined, 401));
      vi.advanceTimersByTime(1000);
      service.handle(new JSendServerError('Unauthorized', undefined, 401));

      expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
      expect(mockTokenSvc.clearAll).toHaveBeenCalledTimes(1);
      expect(mockAlerts.showError).not.toHaveBeenCalled();
    });

    it('redirects again once the 3s window has passed', () => {
      service.handle(new JSendServerError('Unauthorized', undefined, 401));
      vi.advanceTimersByTime(3001);
      service.handle(new JSendServerError('Unauthorized', undefined, 401));

      expect(mockRouter.navigate).toHaveBeenCalledTimes(2);
      expect(mockTokenSvc.clearAll).toHaveBeenCalledTimes(2);
    });
  });

  describe('public routes', () => {
    it('does not evict a guest from /signin on a 401 — surfaces the error instead', () => {
      mockRouter.url = '/signin';
      service.handle(new JSendServerError('Unauthorized', undefined, 401));

      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
      expect(mockAlerts.showError).toHaveBeenCalledWith('Unauthorized');
    });

    it('treats prefix-family routes with query params as public (/f/:slug)', () => {
      mockRouter.url = '/f/abc?x=1';
      service.handle(unauthorizedClientError());

      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
      expect(mockAlerts.showError).toHaveBeenCalledWith('UNAUTHORIZED');
    });

    it('redirectToSignIn() no-ops on a public page', () => {
      mockRouter.url = '/resetpassword';
      service.redirectToSignIn();

      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenSvc.clearAll).not.toHaveBeenCalled();
    });

    it('redirectToSignIn() signs out from a private page', () => {
      service.redirectToSignIn();

      expect(mockTokenSvc.clearAll).toHaveBeenCalledTimes(1);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/persons/42' } });
    });
  });
});
