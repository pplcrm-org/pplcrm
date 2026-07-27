import { TooManyRequestsError } from '../errors/app-errors';

// SECURITY-REVIEW 4.1 — single-instance assumption: this limiter keeps counters in a per-process
// in-memory Map. It resets on deploy/restart and does NOT coordinate across instances, so running
// more than one backend replica effectively multiplies every limit by the replica count. If/when
// this deploys horizontally, back it with a shared store (Postgres or Redis). The public web-forms
// submission limiter (web-forms/controller.ts) carries the same caveat.
const store = new Map<string, number[]>();

// Periodically evict keys whose newest hit is older than any window we use, so
// the map doesn't grow unbounded with distinct IP/action keys over time.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RETENTION_MS = 60 * 60 * 1000; // longest rate-limit window in use
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, hits] of store) {
    const newest = hits[hits.length - 1] ?? 0;
    if (now - newest > MAX_RETENTION_MS) {
      store.delete(key);
    }
  }
}

/**
 * Record a hit and report whether the caller is now over the limit, without throwing.
 *
 * This is the same counter `checkRateLimit` uses — including the sweep above — and exists for the
 * public companion/canvass/deliveries routes, which reply with their own uniform 429 body rather
 * than letting an error propagate. Those routes previously each kept their own `Map` with no
 * eviction at all, so distinct client IPs accumulated for the life of the process.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  store.set(key, hits);
  return hits.length > limit;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  store.set(key, hits);
  if (hits.length > limit) {
    const firstHit = hits[0] ?? now;
    const retryAfterSec = Math.ceil((firstHit + windowMs - now) / 1000);
    throw new TooManyRequestsError(`Too many requests. Retry in ${retryAfterSec} seconds.`, { retryAfterSec });
  }
}
