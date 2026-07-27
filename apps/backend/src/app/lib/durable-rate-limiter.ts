import { sql } from 'kysely';
import { BaseRepository } from './base.repo';
import { TooManyRequestsError } from '../errors/app-errors';
import { logger } from '../logger';

/**
 * A rate limiter whose counters live in Postgres, so they survive a deploy and are shared
 * by every replica.
 *
 * Use this — not the in-memory `rate-limiter.ts` — whenever exceeding the limit costs real
 * money or reputation: paid API calls, SMS, and outbound mail. The in-memory limiter keeps
 * counters in a per-process Map that resets on restart and multiplies by the replica count,
 * which is fine for smoothing request bursts and not fine for an abuse ceiling.
 *
 * Fixed-window buckets: a caller can send up to 2× the limit across a boundary. Accepted
 * deliberately — these caps bound sustained abuse rather than enforce an exact rate.
 */

/** How often (at most) we sweep expired buckets, per process. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** Buckets older than this are unreachable by any window we use. */
const MAX_RETENTION_MS = 25 * 60 * 60 * 1000;

let lastSweep = 0;

function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

async function sweep(now: number): Promise<void> {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    await BaseRepository.dbInstance
      .deleteFrom('rate_limits')
      .where('window_start', '<', new Date(now - MAX_RETENTION_MS))
      .execute();
  } catch (err) {
    // Housekeeping only — never fail a request because the sweep could not run.
    logger.warn({ err }, 'rate_limits sweep failed');
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits recorded in the current window, including this one. */
  count: number;
  retryAfterSec: number;
}

/**
 * Record a hit against `key` and report whether the caller is now over `limit`.
 *
 * The insert-or-increment is a single atomic upsert, so concurrent requests across
 * replicas cannot both read a stale count and both pass.
 *
 * Fails OPEN on a database error: a limiter outage must not take down sign-in or mail.
 * Callers that would rather fail closed should check {@link RateLimitResult.count}.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const start = windowStart(now, windowMs);
  const retryAfterSec = Math.max(1, Math.ceil((start.getTime() + windowMs - now) / 1000));

  void sweep(now);

  try {
    const row = await BaseRepository.dbInstance
      .insertInto('rate_limits')
      .values({ key, window_start: start, count: 1 })
      .onConflict((oc) =>
        oc.columns(['key', 'window_start']).doUpdateSet({
          count: sql<number>`rate_limits.count + 1`,
        }),
      )
      .returning('count')
      .executeTakeFirst();

    const count = Number(row?.count ?? 1);
    return { allowed: count <= limit, count, retryAfterSec };
  } catch (err) {
    logger.error({ err, key }, 'Durable rate limiter unavailable — allowing the request');
    return { allowed: true, count: 0, retryAfterSec };
  }
}

/** As {@link consumeRateLimit}, but throws {@link TooManyRequestsError} when over the limit. */
export async function checkDurableRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message?: string,
): Promise<void> {
  const result = await consumeRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new TooManyRequestsError(message ?? `Too many requests. Retry in ${result.retryAfterSec} seconds.`, {
      retryAfterSec: result.retryAfterSec,
    });
  }
}

/** Read the current count for `key` without recording a hit. */
export async function peekRateLimit(key: string, windowMs: number): Promise<number> {
  try {
    const row = await BaseRepository.dbInstance
      .selectFrom('rate_limits')
      .select('count')
      .where('key', '=', key)
      .where('window_start', '=', windowStart(Date.now(), windowMs))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

/** Clear a key's current bucket — e.g. after a successful sign-in. */
export async function resetRateLimit(key: string, windowMs: number): Promise<void> {
  try {
    await BaseRepository.dbInstance
      .deleteFrom('rate_limits')
      .where('key', '=', key)
      .where('window_start', '=', windowStart(Date.now(), windowMs))
      .execute();
  } catch (err) {
    logger.warn({ err, key }, 'Failed to reset rate limit');
  }
}
