import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';

type Db = Kysely<Models> | Transaction<Models>;

/**
 * Enqueueing boundary re-matching, and the cost rules that shape it.
 *
 * Adding, drawing, uploading, editing or deleting a boundary set changes which areas cover which
 * households, so every one of those writes queues a re-match. None of them costs anything: matching
 * re-reads coordinates already on file and calls no paid service. That is why a match job may run
 * promptly, while geocoding is metered across days.
 *
 * Two guards keep "free" from meaning "unbounded", covering the one thing an abusive workspace can
 * do here — delete and re-add a boundary set in a loop to force repeated full re-matches:
 *
 *  - **Coalescing.** A fresh job is not queued when an equivalent one is already pending. Twenty
 *    saves in a row while nothing has started yet produce one job, not twenty.
 *  - **One at a time per tenant.** The handler defers itself when another match job for the same
 *    workspace is already running, so a workspace can occupy at most one worker slot with matching.
 *
 * Both are cheap because the worst case they prevent is wasted CPU, not a bill.
 */

/** Households processed per pass before the job re-queues itself with a keyset cursor. */
export const BOUNDARY_MATCH_BATCH_SIZE = 500;

/** How long a deferred match job waits when another one is already running for the same tenant. */
export const BOUNDARY_MATCH_DEFER_MS = 60_000;

/**
 * How long a feature edit waits before its re-match pass may start. Coalescing only suppresses a
 * fresh enqueue while an equivalent job is still PENDING, so with an immediate run_at a drawing
 * session — twenty area saves over ten minutes — ran a full-workspace pass per save the moment the
 * worker kept up. Holding the first save's job for a minute lets the rest of the session coalesce
 * into it. Set-level operations (adding a published map, uploading a file) stay immediate: they
 * happen once, and a minute of delay there is pure wait.
 */
export const BOUNDARY_FEATURE_EDIT_SETTLE_MS = 60_000;

/** Which households a match pass walks. */
export type BoundaryMatchScope = 'all' | 'unmatched';

interface BoundaryMatchJobFields {
  tenant_id: string;
  set_id: string | null;
  scope: BoundaryMatchScope;
  cursor: string | null;
}

function matchJobRow(fields: BoundaryMatchJobFields, runAt: Date) {
  return {
    tenant_id: fields.tenant_id,
    queue: 'default',
    status: 'pending' as const,
    payload: JSON.stringify({
      type: 'match_boundaries',
      tenant_id: fields.tenant_id,
      set_id: fields.set_id,
      scope: fields.scope,
      cursor: fields.cursor,
    }),
    run_at: runAt,
    max_attempts: 3,
  };
}

/**
 * Queue a re-match for one boundary set, or for every set the workspace requires.
 *
 * Call this INSIDE the transaction that changed the boundary data, per the transactional-outbox
 * pattern: a rolled-back save must not leave a job behind that re-matches against polygons that
 * were never committed.
 *
 * Coalescing looks only at fresh (uncursored) pending jobs with the same target and scope. A
 * continuation job — one carrying a cursor, mid-way through a large workspace — never suppresses a
 * fresh enqueue, because it resumes from its cursor and would skip everything before it.
 */
export async function enqueueBoundaryMatch(
  db: Db,
  tenantId: string,
  setId: string | null,
  scope: BoundaryMatchScope = 'all',
  delayMs = 0,
): Promise<void> {
  const existing = await db
    .selectFrom('background_jobs')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'pending')
    .where(sql<string>`payload->>'type'`, '=', 'match_boundaries')
    .where(sql<string>`payload->>'scope'`, '=', scope)
    .where(sql<boolean>`payload->>'cursor' IS NULL`)
    .where(sql<boolean>`payload->>'set_id' IS NOT DISTINCT FROM ${setId}`)
    .executeTakeFirst();
  if (existing) return;

  await db
    .insertInto('background_jobs')
    .values(
      matchJobRow(
        { tenant_id: tenantId, set_id: setId, scope, cursor: null },
        new Date(Date.now() + Math.max(0, delayMs)),
      ),
    )
    .execute();
}

/**
 * Queue the next page of an in-progress match pass, or re-queue a pass that stood down.
 *
 * Deliberately not coalesced: a continuation is the only thing that will process the households
 * after its cursor, so dropping it would silently leave part of the workspace unmatched. A pass
 * that stood down because another was already running re-queues through here too, carrying its
 * original cursor — which may be null, meaning it had not started yet.
 */
export async function enqueueBoundaryMatchContinuation(
  db: Db,
  tenantId: string,
  setId: string | null,
  scope: BoundaryMatchScope,
  cursor: string | null,
  delayMs = 0,
): Promise<void> {
  await db
    .insertInto('background_jobs')
    .values(
      matchJobRow({ tenant_id: tenantId, set_id: setId, scope, cursor }, new Date(Date.now() + Math.max(0, delayMs))),
    )
    .execute();
}

/**
 * How many match jobs this workspace already has running.
 *
 * The caller is itself one of them (the worker marks a job 'processing' before invoking the
 * handler), so a result above one means somebody else is working too and the caller should stand
 * down. Losing the race only costs a minute of delay, never correctness: matching is idempotent, so
 * running twice would produce the same rows.
 */
export async function runningBoundaryMatchCount(db: Db, tenantId: string): Promise<number> {
  const row = await db
    .selectFrom('background_jobs')
    .select((eb) => eb.fn.countAll().as('cnt'))
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'processing')
    .where(sql<string>`payload->>'type'`, '=', 'match_boundaries')
    .executeTakeFirst();
  return Number(row?.cnt ?? 0);
}
