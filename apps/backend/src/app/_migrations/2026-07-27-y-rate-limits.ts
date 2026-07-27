import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * A durable, cross-instance counter for rate limits.
 *
 * SECURITY (findings M1, H3, H4, C5): every limit in the app lived in a per-process
 * `Map` whose own comment conceded it "does NOT coordinate across instances, so running
 * more than one backend replica effectively multiplies every limit by the replica count"
 * — and it resets on every deploy. That is tolerable for smoothing bursts, but not for
 * the limits that are the only thing standing between an attacker and a real cost:
 * paid AI calls, Twilio SMS, and outbound mail on shared sending reputation.
 *
 * Fixed-window buckets, not a sliding window: a caller can in principle send up to 2×
 * the limit across a bucket boundary. That is the standard trade and is fine here —
 * these caps exist to bound sustained abuse, not to be exact.
 *
 * `key` is caller-constructed and namespaced (e.g. `signIn:acct:<id>`, `txmail:<tenant>`).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.rate_limits (
      key           text        NOT NULL,
      window_start  timestamptz NOT NULL,
      count         integer     NOT NULL DEFAULT 0,
      PRIMARY KEY (key, window_start)
    )
  `.execute(db);

  // Supports the periodic sweep of expired buckets.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
      ON public.rate_limits (window_start)
  `.execute(db);

  // Counters are global infrastructure, not tenant data: the keys they hold are for
  // pre-auth subjects (an IP, an email) as well as tenants, and the limiter runs
  // outside any tenant context. RLS would have nothing to scope by.
  await sql`ALTER TABLE public.rate_limits DISABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.rate_limits`.execute(db);
}
