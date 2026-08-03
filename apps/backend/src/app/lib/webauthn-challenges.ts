const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Abandoned ceremonies (closed tab, cancelled biometric prompt, unauthenticated probe of the
// public options endpoint) never reach consumeChallenge, so expired entries must be swept on
// the write path or the map grows for the life of the process.
const SWEEP_INTERVAL_MS = 60 * 1000;
// Backstop against a burst of option requests outpacing the sweep between runs.
const MAX_ENTRIES = 10_000;
let lastSweep = Date.now();

const store = new Map<string, { challenge: string; expiresAt: number }>();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

export function storeChallenge(key: string, challenge: string): void {
  const now = Date.now();
  sweep(now);
  // Map iterates in insertion order, so the first keys are the oldest challenges.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest == null) break;
    store.delete(oldest);
  }
  store.set(key, { challenge, expiresAt: now + CHALLENGE_TTL_MS });
}

/** Current entry count — exists so tests can assert eviction actually removes entries. */
export function challengeStoreSize(): number {
  return store.size;
}

// Returns the challenge and removes it (one-time use)
export function consumeChallenge(key: string): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  store.delete(key);
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}
