import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { challengeStoreSize, consumeChallenge, storeChallenge } from './webauthn-challenges';

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 10_000;

describe('webauthn challenge store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a stored challenge exactly once', () => {
    storeChallenge('reg:user-1', 'challenge-a');
    expect(consumeChallenge('reg:user-1')).toBe('challenge-a');
    expect(consumeChallenge('reg:user-1')).toBeNull();
  });

  it('refuses an expired challenge', () => {
    storeChallenge('auth:nonce-1', 'challenge-b');
    vi.advanceTimersByTime(TTL_MS + 1);
    expect(consumeChallenge('auth:nonce-1')).toBeNull();
  });

  it('sweeps abandoned expired entries on a later store', () => {
    // Abandoned ceremonies: stored, never consumed.
    for (let i = 0; i < 5; i++) {
      storeChallenge(`auth:abandoned-${i}`, `challenge-${i}`);
    }

    // Far enough that the entries above are expired AND the sweep interval has elapsed
    // (regardless of when a previous test's store last ran the sweep).
    vi.advanceTimersByTime(10 * 60 * 1000);

    storeChallenge('auth:fresh', 'challenge-fresh');
    expect(challengeStoreSize()).toBe(1);
    expect(consumeChallenge('auth:fresh')).toBe('challenge-fresh');
  });

  it('evicts oldest entries past the size cap without waiting for the sweep', () => {
    for (let i = 0; i < MAX_ENTRIES + 50; i++) {
      storeChallenge(`auth:burst-${i}`, `challenge-${i}`);
    }
    expect(challengeStoreSize()).toBeLessThanOrEqual(MAX_ENTRIES);
    // Newest survives; the overflowed oldest do not.
    expect(consumeChallenge(`auth:burst-${MAX_ENTRIES + 49}`)).toBe(`challenge-${MAX_ENTRIES + 49}`);
    expect(consumeChallenge('auth:burst-0')).toBeNull();
  });
});
