import { describe, it, expect, afterEach } from 'vitest';
import { TRPCClientError } from '@trpc/client';
import { JSendServerError } from '../../../../../../libs/common/src';
import { ApiError } from './api-error';
import { getUserErrorMessage, isServerUnreachable, OFFLINE_MESSAGE, SERVER_UNREACHABLE_MESSAGE } from './user-message';

const FALLBACK = 'Something went wrong, please try again';

/** A tRPC error that actually came from the server always carries a `data` payload with a code. */
function serverAuthoredTRPCError(message: string, code = 'UNAUTHORIZED', httpStatus = 401): TRPCClientError<never> {
  const err = new TRPCClientError(message);
  (err as unknown as { data: unknown }).data = { code, httpStatus };
  return err;
}

/**
 * tRPC's client re-wraps whatever our errorLink throws into a fresh, data-less TRPCClientError,
 * keeping the original underneath as `cause`. This mirrors what reaches the sign-in page.
 */
function reWrappedError(inner: unknown): TRPCClientError<never> {
  const outer = new TRPCClientError('Please check your email and password and try again.');
  (outer as unknown as { cause: unknown }).cause = inner;
  return outer;
}

describe('getUserErrorMessage', () => {
  it('shows an ApiError message as-is (backend-sanitized copy)', () => {
    expect(getUserErrorMessage(new ApiError('Could not save the person'), FALLBACK)).toBe('Could not save the person');
  });

  it('falls back when an ApiError has an empty message', () => {
    expect(getUserErrorMessage(new ApiError(''), FALLBACK)).toBe(FALLBACK);
  });

  it('shows a server-authored TRPCClientError message as-is', () => {
    expect(getUserErrorMessage(serverAuthoredTRPCError('Duplicate name', 'CONFLICT', 409), FALLBACK)).toBe(
      'Duplicate name',
    );
  });

  it('shows the unreachable copy for a data-less tRPC error — the request never reached the server', () => {
    expect(getUserErrorMessage(new TRPCClientError('Failed to fetch'), FALLBACK)).toBe(SERVER_UNREACHABLE_MESSAGE);
  });

  it('shows a JSendServerError messageText', () => {
    expect(getUserErrorMessage(new JSendServerError('Upstream unavailable', undefined, 502), FALLBACK)).toBe(
      'Upstream unavailable',
    );
  });

  it('falls back when a JSendServerError has an empty messageText', () => {
    expect(getUserErrorMessage(new JSendServerError('', undefined, 500), FALLBACK)).toBe(FALLBACK);
  });

  it('shows a plain Error message (app-authored copy)', () => {
    expect(getUserErrorMessage(new Error('Pick a campaign first'), FALLBACK)).toBe('Pick a campaign first');
  });

  it('falls back for Error subclasses like TypeError — internals must never leak to the UI', () => {
    expect(getUserErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(getUserErrorMessage(new RangeError('Invalid array length'), FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for a plain Error with an empty message', () => {
    expect(getUserErrorMessage(new Error(''), FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for non-Error values', () => {
    expect(getUserErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(getUserErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(getUserErrorMessage('raw string error', FALLBACK)).toBe(FALLBACK);
    expect(getUserErrorMessage({ message: 'not a real Error' }, FALLBACK)).toBe(FALLBACK);
    expect(getUserErrorMessage(42, FALLBACK)).toBe(FALLBACK);
  });

  it('shows the server message for a re-wrapped 401, not the unreachable copy', () => {
    // tRPC re-wraps the errorLink's error into a data-less outer TRPCClientError; the server-
    // authored 401 survives as its cause. This is exactly a wrong-password sign-in.
    const err = reWrappedError(serverAuthoredTRPCError('Please check your email and password and try again.'));
    expect(getUserErrorMessage(err, FALLBACK)).toBe('Please check your email and password and try again.');
  });
});

describe('isServerUnreachable', () => {
  it('is true for a data-less tRPC error with no server-authored cause (real outage)', () => {
    expect(isServerUnreachable(new TRPCClientError('Failed to fetch'))).toBe(true);
  });

  it('is false when a server-authored error is present directly', () => {
    expect(isServerUnreachable(serverAuthoredTRPCError('Please check your email and password and try again.'))).toBe(
      false,
    );
  });

  it('is false when the server-authored error survives under a re-wrapping outer error', () => {
    const err = reWrappedError(serverAuthoredTRPCError('Please check your email and password and try again.'));
    expect(isServerUnreachable(err)).toBe(false);
  });

  it('is false when the server error is wrapped in an ApiError (errorLink output)', () => {
    const err = new ApiError('Please check your email and password and try again.', serverAuthoredTRPCError('bad'));
    expect(isServerUnreachable(err)).toBe(false);
  });

  it('is true for a non-tRPC error', () => {
    expect(isServerUnreachable(new Error('boom'))).toBe(false);
    expect(isServerUnreachable(null)).toBe(false);
  });
});

// The CRM previously had no notion of connectivity at all, so a dropped wifi connection and a
// backend outage produced the same guess ("check your internet connection"). When the browser
// already knows it is offline, say so.
describe('offline vs unreachable', () => {
  const FALLBACK = 'Something went wrong.';
  const unreachable = new TRPCClientError('Failed to fetch');
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');

  function setOnLine(value: boolean): void {
    Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
  }

  afterEach(() => {
    if (original) Object.defineProperty(globalThis.navigator, 'onLine', original);
  });

  it('names the offline state when the browser reports no connection', () => {
    setOnLine(false);
    expect(getUserErrorMessage(unreachable, FALLBACK)).toBe(OFFLINE_MESSAGE);
  });

  it('falls back to the outage wording when the browser is online', () => {
    setOnLine(true);
    expect(getUserErrorMessage(unreachable, FALLBACK)).toBe(SERVER_UNREACHABLE_MESSAGE);
  });

  it('does not hijack a real server-authored error while offline', () => {
    setOnLine(false);
    const serverError = new TRPCClientError('That name is already taken.');
    (serverError as { data?: unknown }).data = { code: 'CONFLICT' };
    expect(getUserErrorMessage(serverError, FALLBACK)).toBe('That name is already taken.');
  });
});
