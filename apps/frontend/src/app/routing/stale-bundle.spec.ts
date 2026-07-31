import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claimReloadForStaleBundle, isStaleBundleError } from './stale-bundle';

describe('isStaleBundleError', () => {
  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: https://app.pplcrm.com/chunk-BJHSTgRT.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    [
      'Chrome MIME refusal',
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
    ],
  ])('recognises the %s wording', (_engine, message) => {
    expect(isStaleBundleError(new TypeError(message))).toBe(true);
  });

  it('recognises a bare string message', () => {
    expect(isStaleBundleError('Failed to fetch dynamically imported module: /chunk-a.js')).toBe(true);
  });

  it('leaves unrelated errors alone', () => {
    expect(isStaleBundleError(new Error('Failed to fetch'))).toBe(false);
    expect(isStaleBundleError(new TypeError('x is not a function'))).toBe(false);
    expect(isStaleBundleError(null)).toBe(false);
    expect(isStaleBundleError({ message: 'Failed to fetch dynamically imported module' })).toBe(false);
  });
});

describe('claimReloadForStaleBundle', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('grants the first reload', () => {
    expect(claimReloadForStaleBundle()).toBe(true);
  });

  it('refuses a second reload inside the cooldown, so a missing chunk cannot loop', () => {
    expect(claimReloadForStaleBundle()).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(claimReloadForStaleBundle()).toBe(false);
  });

  it('grants again once the cooldown has passed', () => {
    expect(claimReloadForStaleBundle()).toBe(true);
    vi.advanceTimersByTime(31_000);
    expect(claimReloadForStaleBundle()).toBe(true);
  });

  it('refuses when sessionStorage is unavailable — without a marker there is no loop guard', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    expect(claimReloadForStaleBundle()).toBe(false);
  });
});
