import * as Sentry from '@sentry/node';
import { sql } from 'kysely';
import { Client } from 'pg';

import { env } from '../../../env';
import { logger } from '../../logger';
import { ImportsRepo } from '../../modules/imports/repositories/imports.repo';
import { CRON_JOBS, isCronJobType, jobTimeoutMs } from './cron-registry';
import { claimNextPendingJob } from './job-claim';
import { executeJob } from './job-handlers';
import { scheduleNextRun, seedCronJob } from './reschedule';

// Backoff before polling again once the queue drained empty.
const IDLE_POLL_MS = 30000;

// Worker-pool slots kept out of any single tenant's reach, so one tenant's large batch can never
// occupy the whole pool and starve others (per-tenant in-flight fairness; see claimNextPendingJob).
const RESERVED_SLOTS = 1;

// A 'processing' job whose lock is older than this is treated as abandoned (its worker died) and
// recovered. While a job runs we refresh its lock every JOB_HEARTBEAT_MS so a legitimately long
// job (large import/sync/newsletter) is never mistaken for stale and double-run; the heartbeat
// interval sits well under the threshold so several heartbeats land within one stale window.
const STALE_JOB_THRESHOLD_MS = 30 * 60 * 1000;
const JOB_HEARTBEAT_MS = 5 * 60 * 1000;

// How long stop() waits for in-flight jobs to finish before releasing them back to the queue.
// Deliberately shorter than DEFAULT_SHUTDOWN_TIMEOUT_MS (25s) in shutdown.ts, which force-exits
// the process after SIGTERM: the ~10s gap is the budget for the release UPDATEs to commit before
// the force-exit lands. Without this release, a job killed mid-flight would sit invisible in
// 'processing' until recoverStaleJobs reclaims it after STALE_JOB_THRESHOLD_MS (30 minutes), and
// would burn one of its attempts on a deploy that was never the job's fault.
const SHUTDOWN_DRAIN_DEADLINE_MS = 15_000;

// A job released at shutdown becomes runnable again only after this delay. Invariant: 90s exceeds
// the force-exit window remaining after the drain deadline (25s − 15s = 10s), so the old process
// is certainly dead before any new process can claim the row — the un-cancellable zombie handler
// promise can never run concurrently with a re-claim.
const SHUTDOWN_RELEASE_RUN_DELAY_MS = 90_000;

/**
 * Thrown when a handler outlives its wall-clock cap (see jobTimeoutMs). Distinct class because the
 * failure path treats it differently from an ordinary error: the timed-out promise keeps running.
 */
class JobExecutionTimeoutError extends Error {
  constructor(type: string, timeoutMs: number) {
    super(`Job '${type}' exceeded its ${Math.round(timeoutMs / 1000)}s execution timeout`);
    this.name = 'JobExecutionTimeoutError';
  }
}

export class BackgroundJobWorker {
  private readonly importsRepo = new ImportsRepo();
  private readonly db = this.importsRepo.db; // Kysely DB instance

  // Number of jobs currently in flight (real concurrency), capped at maxConcurrency.
  private activeJobsCount = 0;
  // Ids of the job rows currently being executed by this process (added at claim, removed when the
  // job settles). stop() uses this to release still-running rows back to 'pending' when the drain
  // deadline passes, instead of leaving them stuck in 'processing' until stale recovery.
  private readonly inFlightJobIds = new Set<string>();
  private readonly maxConcurrency = env.workerConcurrency;
  private isRunning = false;
  // Instance field (not a const reference at the callsite) so tests can shorten the wait.
  private shutdownDrainDeadlineMs = SHUTDOWN_DRAIN_DEADLINE_MS;
  // Epoch ms the next drain is scheduled for, so overlapping schedule requests coalesce to the
  // soonest one instead of stacking timers.
  private nextDrainAt = Number.POSITIVE_INFINITY;
  private pgClient: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private shutdownResolver: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Background Job Worker started.');

    // Seed the first run of every recurring job straight from the registry, so the set can't drift
    // from CRON_JOBS. Seeds are independent and non-blocking: one failure (lock wait, transient DB
    // error) must not stop the other seeds or the rest of start(). The .filter(isCronJobType) is
    // only there to narrow Object.keys' string[] to CronJobType[].
    for (const type of Object.keys(CRON_JOBS).filter(isCronJobType)) {
      seedCronJob(this.db, type).catch((err) => logger.error({ err, type }, 'Failed to seed recurring job'));
    }

    // Run stale job recovery on startup and then every 5 minutes
    this.recoverStaleJobs().catch((err) => logger.error({ err }, 'Failed to recover stale jobs on startup'));
    this.recoveryInterval = setInterval(
      () => {
        this.recoverStaleJobs().catch((err) => logger.error({ err }, 'Failed to recover stale jobs'));
      },
      5 * 60 * 1000,
    );

    void this.setupListener();
    this.drain();
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.nextDrainAt = Number.POSITIVE_INFINITY;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    if (this.pgClient) {
      try {
        await this.pgClient.end();
      } catch (err) {
        logger.error({ err }, 'Error closing Postgres listener client on shutdown');
      }
      this.pgClient = null;
    }

    if (this.activeJobsCount > 0) {
      logger.info(
        `Background Job Worker: Waiting for ${this.activeJobsCount} active jobs to complete before shutting down...`,
      );
      const drained = new Promise<void>((resolve) => {
        this.shutdownResolver = resolve;
      });

      // Wait for a clean drain, but only up to SHUTDOWN_DRAIN_DEADLINE_MS: shutdown.ts force-exits
      // the process soon after, so past the deadline we hand the still-running jobs back to the
      // queue while there is still time for those UPDATEs to reach the database.
      let deadlineTimer: NodeJS.Timeout | undefined;
      const drainedInTime = await Promise.race([
        drained.then(() => true),
        new Promise<boolean>((resolve) => {
          deadlineTimer = setTimeout(() => resolve(false), this.shutdownDrainDeadlineMs);
          if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
        }),
      ]);
      if (deadlineTimer) clearTimeout(deadlineTimer);

      if (!drainedInTime) {
        await this.releaseInFlightJobs();
      }
    }
    logger.info('Background Job Worker stopped.');
  }

  /**
   * Fill every free slot in the worker pool with a claimer. Each claimer runs one job (or finds the
   * queue empty) and, on completion, schedules the next drain — so the pool stays topped up to
   * `maxConcurrency` while there is work, and backs off when there isn't. Slot bookkeeping
   * (`activeJobsCount++`) happens synchronously here so we never launch past the cap.
   */
  private drain(): void {
    if (!this.isRunning) return;
    while (this.activeJobsCount < this.maxConcurrency) {
      this.activeJobsCount++;
      void this.processSlot();
    }
  }

  private async processSlot(): Promise<void> {
    let processedAJob = false;
    try {
      processedAJob = await this.processNextJob();
    } catch (err) {
      logger.error({ err }, 'Error in background job worker poll cycle');
    } finally {
      this.activeJobsCount--;

      // If shutdown was requested and no active jobs remain, resolve the stop() promise.
      if (!this.isRunning && this.activeJobsCount === 0 && this.shutdownResolver) {
        this.shutdownResolver();
      } else {
        // Look for more work immediately if we just processed a job (keep the pool full to drain the
        // queue), or back off if the queue was empty.
        this.scheduleDrain(processedAJob ? 0 : IDLE_POLL_MS);
      }
    }
  }

  /**
   * Schedule a drain in `ms`, coalescing with any already-pending drain: the soonest requested time
   * wins, so a just-finished slot's immediate re-poll supersedes an idle slot's long backoff.
   */
  private scheduleDrain(ms: number) {
    if (!this.isRunning) return;
    const fireAt = Date.now() + ms;
    if (this.timer && this.nextDrainAt <= fireAt) return; // a sooner (or equal) drain is already queued
    if (this.timer) clearTimeout(this.timer);
    this.nextDrainAt = fireAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextDrainAt = Number.POSITIVE_INFINITY;
      this.drain();
    }, ms);
  }

  private async processNextJob(): Promise<boolean> {
    const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 9)}`;

    // Per-tenant in-flight fairness: a tenant may hold at most (pool − RESERVED_SLOTS) jobs in flight,
    // so one tenant's big batch can never take the whole pool. See claimNextPendingJob.
    const inFlightCap = Math.max(1, this.maxConcurrency - RESERVED_SLOTS);
    const job = await claimNextPendingJob(this.db, workerId, inFlightCap);

    if (!job) return false;

    // Registered before the handler starts so a shutdown at any point mid-execution can find and
    // release this row; removed in the finally below once the job has settled either way.
    this.inFlightJobIds.add(job.id);

    logger.info({ jobId: job.id, queue: job.queue }, 'Processing job');

    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;

    // Keep this job's lock fresh while it runs so recoverStaleJobs never reclaims a healthy
    // long-running job out from under us. Scoped to (this job, still processing, still ours) so it
    // can't revive a job another worker legitimately took over. Unref'd so it never holds the
    // process open during shutdown.
    const heartbeat = setInterval(() => {
      void this.db
        .updateTable('background_jobs')
        .set({ locked_at: new Date(), updated_at: new Date() })
        .where('id', '=', job.id)
        .where('status', '=', 'processing')
        .where('locked_by', '=', workerId)
        .execute()
        .catch((err) => logger.error({ err, jobId: job.id }, 'Job heartbeat failed'));
    }, JOB_HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    // Wall-clock cap. The heartbeat above keeps `locked_at` fresh, so a live-but-wedged handler
    // (a hung HTTP call, a lock wait) would never look stale to recoverStaleJobs and would hold its
    // pool slot forever. Racing the handler against a timer is what makes that recoverable.
    const payloadType = typeof payload.type === 'string' ? payload.type : undefined;
    const timeoutMs = jobTimeoutMs(payloadType);
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        executeJob(payload, this.db, job.id),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new JobExecutionTimeoutError(payloadType ?? 'unknown', timeoutMs)),
            timeoutMs,
          );
          if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
        }),
      ]);

      // Mark job as completed
      await this.db
        .updateTable('background_jobs')
        .set({
          status: 'completed',
          locked_at: null,
          locked_by: null,
          updated_at: new Date(),
        })
        .where('id', '=', job.id)
        .execute();

      logger.info({ jobId: job.id }, 'Job completed successfully');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id }, 'Failed to process background job');
      // Job failures never surface through a request path, so capture them here explicitly
      // (no-op when SENTRY_DSN is unset).
      Sentry.captureException(err, {
        tags: { jobType: String(payload.type ?? 'unknown') },
        extra: { jobId: job.id, attempts: job.attempts },
      });

      const attempts = Number(job.attempts || 0);
      const maxAttempts = Number(job.max_attempts || 3);

      try {
        // If it was an import job, mark the import as failed and store the error message —
        // but ONLY once no retry is left. A retry is still scheduled below while attempts
        // remain, and a `failed` import is terminal to the wizard: it stops polling, shows the
        // error and offers "Try again", which starts a SECOND import of the same file. The
        // companies, households and tasks importers do not deduplicate, so every row would land
        // twice while the original attempt was still on its way to succeeding.
        if (payload.import_id && attempts >= maxAttempts) {
          await this.importsRepo.update({
            tenant_id: payload.tenant_id,
            id: payload.import_id,
            row: {
              status: 'failed',
              error_message: errorMsg.substring(0, 1000), // Truncate just in case
              processed_at: new Date(),
              updated_at: new Date(),
            },
          });
        }
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Failed to mark data_imports as failed');
      }

      if (attempts < maxAttempts) {
        // Retry with backoff (exponential backoff for mail, linear for others)
        const isMail =
          payload.type === 'send-transactional-email' ||
          payload.type === 'send-form-notifications' ||
          payload.type === 'send-webform-notifications' ||
          payload.type === 'send-shift-reminder' ||
          payload.type === 'send-newsletter' ||
          payload.type === 'send-bug-report-email';
        const delaySeconds = isMail ? Math.pow(2, attempts) * 30 : attempts * 30;
        // A timed-out handler's promise cannot be cancelled and may still be writing. Defer the
        // retry past the stale-recovery window instead of the usual seconds-scale backoff: by then
        // the zombie has either finished or died, so the retry can't run concurrently with it.
        const retryDelayMs = err instanceof JobExecutionTimeoutError ? STALE_JOB_THRESHOLD_MS : delaySeconds * 1000;
        const runAt = new Date(Date.now() + retryDelayMs);
        logger.info({ jobId: job.id, runAt: runAt.toISOString(), attempt: attempts, maxAttempts }, 'Rescheduling job');

        await this.db
          .updateTable('background_jobs')
          .set({
            status: 'pending',
            locked_at: null,
            locked_by: null,
            error: errorMsg,
            run_at: runAt,
            updated_at: new Date(),
          })
          .where('id', '=', job.id)
          .execute();
      } else {
        logger.error({ jobId: job.id, maxAttempts }, 'Job exceeded maximum attempts, marking as failed');
        await this.db
          .updateTable('background_jobs')
          .set({
            status: 'failed',
            locked_at: null,
            locked_by: null,
            error: errorMsg,
            updated_at: new Date(),
          })
          .where('id', '=', job.id)
          .execute();

        if (payload.export_id) {
          try {
            const { ExportsRepo } = await import('../../modules/exports/repositories/exports.repo');
            const exportsRepo = new ExportsRepo();
            await exportsRepo.updateStatus(String(payload.export_id), String(payload.tenant_id), 'failed', {
              error: `Export failed after all retries. Last error: ${errorMsg.substring(0, 400)}`,
            });
          } catch (exportErr) {
            logger.error({ err: exportErr }, 'Failed to update export status on job permanent failure');
          }
        }

        if (payload.type === 'render-receipt-pdf' && payload.receipt_id && payload.tenant_id) {
          // Stamp the receipt so the screens can say "the PDF could not be generated" and offer a
          // retry. Without this the row is indistinguishable from one still rendering, and the
          // download button stays disabled forever under a tooltip promising it is on its way.
          try {
            const { ReceiptsRepo } = await import('../../modules/donations/repositories/receipts.repo');
            await new ReceiptsRepo().markRenderFailed(String(payload.tenant_id), String(payload.receipt_id), errorMsg);
          } catch (receiptErr) {
            logger.error({ err: receiptErr }, 'Failed to mark receipt PDF as failed after permanent job failure');
          }
        }

        if (payload.type === 'ms_sync' && payload.tenantId && payload.campaignId) {
          const correlationId = Math.random().toString(36).slice(2, 10).toUpperCase();
          logger.error(
            { err, correlationId, tenantId: payload.tenantId, campaignId: payload.campaignId },
            'MS sync permanently failed',
          );
          try {
            const { MsOAuthService } = await import('../../modules/ms-sync/ms-oauth.service');
            const { env } = await import('../../../env');
            const oauthSvc = new MsOAuthService(this.db, {
              clientId: env.msClientId ?? '',
              clientSecret: env.msClientSecret ?? '',
              tenantId: env.msTenantId ?? 'common',
              redirectUri: env.msRedirectUri ?? `${env.apiUrl}/auth/ms/callback`,
            });
            await oauthSvc.recordSyncError(
              String(payload.tenantId),
              String(payload.campaignId),
              `Sync failed — support code: ${correlationId}`,
            );
          } catch (recordErr) {
            logger.error({ err: recordErr }, 'Failed to record MS sync error on token');
          }
        }

        if (payload.type === 'google_sync' && payload.tenantId && payload.campaignId) {
          const correlationId = Math.random().toString(36).slice(2, 10).toUpperCase();
          logger.error(
            { err, correlationId, tenantId: payload.tenantId, campaignId: payload.campaignId },
            'Google sync permanently failed',
          );
          try {
            const { GoogleOAuthService } = await import('../../modules/google-sync/google-oauth.service');
            const { env } = await import('../../../env');
            const oauthSvc = new GoogleOAuthService(this.db, {
              clientId: env.googleClientId ?? '',
              clientSecret: env.googleClientSecret ?? '',
              redirectUri: env.googleRedirectUri ?? `${env.apiUrl}/auth/google/callback`,
            });
            await oauthSvc.recordSyncError(
              String(payload.tenantId),
              String(payload.campaignId),
              `Sync failed — support code: ${correlationId}`,
            );
          } catch (recordErr) {
            logger.error({ err: recordErr }, 'Failed to record Google sync error on token');
          }
        }

        if (payload.type === 'send-newsletter' && payload.newsletterId && payload.tenantId) {
          // The send job is dead-lettered, but the newsletter is still flagged queuing/sending —
          // which blocks both re-sending and editing, stranding it forever. Move it to 'paused' so
          // the owner can resume from the resume UI; the persisted send_offset/send_cursor make the
          // resume continue from where it stopped rather than re-emailing everyone.
          try {
            await this.db
              .updateTable('newsletters')
              .set({ status: 'paused', updated_at: new Date() })
              .where('tenant_id', '=', String(payload.tenantId))
              .where('id', '=', String(payload.newsletterId))
              .where('status', 'in', ['queuing', 'sending'])
              .execute();
            logger.warn(
              { tenantId: payload.tenantId, newsletterId: payload.newsletterId },
              'Newsletter send permanently failed — moved to paused for supervised resume',
            );
          } catch (nlErr) {
            logger.error({ err: nlErr }, 'Failed to reset newsletter status after permanent send failure');
          }
        }

        // If a recurrent cron-like job fails permanently, schedule the next iteration
        await this.rescheduleCronJobOnFailure(payload.type);
      }
    } finally {
      // Reached on success, on handler failure, and on timeout — so neither the heartbeat interval
      // nor the timeout timer can outlive the job.
      this.inFlightJobIds.delete(job.id);
      clearInterval(heartbeat);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    return true;
  }

  private reconnectListener() {
    if (this.pgClient) {
      void this.pgClient.end().catch(() => {
        /* noop */
      });
      this.pgClient = null;
    }
    if (!this.isRunning) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.setupListener();
    }, 5000);
  }

  private async recoverStaleJobs(): Promise<void> {
    try {
      const staleTime = new Date(Date.now() - STALE_JOB_THRESHOLD_MS);

      // A job that crashes the worker process (OOM, native fault, an escaping rejection) stops
      // heartbeating and never reaches the catch that enforces max_attempts, so it goes stale.
      // Dead-letter such a job once it has been claimed max_attempts times instead of requeuing it
      // forever — otherwise a poison job re-crashes the worker every stale window indefinitely.
      // `attempts` is incremented at claim time, so it reflects real tries.
      const deadLettered = await this.db
        .updateTable('background_jobs')
        .set({
          status: 'failed',
          locked_at: null,
          locked_by: null,
          updated_at: new Date(),
          error: 'Job processing timed out after maximum attempts',
        })
        .where('status', '=', 'processing')
        .where('locked_at', '<', staleTime)
        .where(sql<boolean>`attempts >= coalesce(max_attempts, 3)`)
        .returning([
          sql<string | null>`payload->>'type'`.as('type'),
          sql<string | null>`payload->>'import_id'`.as('import_id'),
          sql<string | null>`payload->>'tenant_id'`.as('tenant_id'),
        ])
        .execute();

      // A CSV import whose worker process died never reaches the in-process catch that stamps
      // `data_imports`, so the row stayed at 'processing' forever: the History page narrated a
      // running import that no longer existed, and delete refuses a processing row, so it could
      // not even be cleared. Now that its job is dead-lettered, the import it belongs to is
      // failed too — the same thing the exports sweep below does for stuck exports.
      for (const row of deadLettered) {
        if (!row.import_id || !row.tenant_id) continue;
        try {
          await this.db
            .updateTable('data_imports')
            .set({
              status: 'failed',
              error_message: 'The import stopped unexpectedly and could not be finished. Please try importing again.',
              processed_at: new Date(),
              updated_at: new Date(),
            })
            .where('tenant_id', '=', row.tenant_id)
            .where('id', '=', row.import_id)
            .where('status', 'in', ['pending', 'processing'])
            .execute();
        } catch (importErr) {
          logger.error({ err: importErr }, 'Failed to mark a dead-lettered import as failed');
        }
      }

      // Mirror of the in-process dead-letter path in processNextJob: a dead-lettered recurring
      // (cron) job whose chain isn't re-seeded silently stops until the next deploy — retention
      // pruning, scheduled deletions, the ops watchdog itself. rescheduleCronJobOnFailure no-ops
      // for non-cron types and scheduleNextRun dedups under an advisory lock, so calling it for
      // every distinct dead-lettered type is safe.
      const deadLetteredTypes = new Set(
        deadLettered.map((row) => row.type).filter((type): type is string => type != null),
      );
      for (const type of deadLetteredTypes) {
        await this.rescheduleCronJobOnFailure(type);
      }

      // Requeue stale jobs that still have retries left.
      await this.db
        .updateTable('background_jobs')
        .set({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          updated_at: new Date(),
          error: 'Job processing timed out',
        })
        .where('status', '=', 'processing')
        .where('locked_at', '<', staleTime)
        .where(sql<boolean>`attempts < coalesce(max_attempts, 3)`)
        .execute();

      // Clean up/timeout data exports stuck in pending/processing for more than 1 hour
      const staleExportTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
      // NOTE: unscoped by design — queue-hygiene sweep over EVERY tenant's stuck exports; it
      // reads only ids (plus the tenant_id used to scope the per-export job cleanup below).
      // eslint-disable-next-line local/no-unscoped-db-query
      const staleExports = await this.db
        .selectFrom('data_exports')
        .select(['id', 'tenant_id'])
        .where('status', 'in', ['pending', 'processing'])
        .where('created_at', '<', staleExportTime)
        .execute();

      if (staleExports.length > 0) {
        const ids = staleExports.map((e) => e.id);
        // NOTE: unscoped by design — the ids come from the sweep above and are globally-unique
        // primary keys; the update deliberately spans tenants (same queue-hygiene pass).
        // eslint-disable-next-line local/no-unscoped-db-query
        await this.db
          .updateTable('data_exports')
          .set({
            status: 'failed',
            error: 'Export processing timed out',
            updated_at: new Date(),
          })
          .where('id', 'in', ids)
          .execute();

        for (const exp of staleExports) {
          await this.db
            .deleteFrom('background_jobs')
            .where('tenant_id', '=', exp.tenant_id)
            .where(sql`payload->>'type'`, '=', 'export_csv')
            .where(sql`payload->>'export_id'`, '=', String(exp.id))
            .execute();
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to recover stale background jobs');
    }
  }

  /**
   * Shutdown drain deadline passed with jobs still running: hand their rows back to the queue so
   * the next deploy's worker picks them up ~90s later instead of 30 minutes later via stale
   * recovery. The attempts decrement refunds the claim-time increment — a deploy kill is not a
   * real execution failure, and without the refund three deploys against the same long job would
   * dead-letter it. Guarded on status='processing' so a job that finishes (or fails) between the
   * deadline and the force-exit keeps its final state — the settle path's UPDATE and this one can
   * never both win.
   */
  private async releaseInFlightJobs(): Promise<void> {
    const jobIds = [...this.inFlightJobIds];
    if (jobIds.length === 0) return;

    logger.warn({ jobIds }, 'Shutdown drain deadline passed; releasing in-flight jobs back to pending');
    try {
      await this.db
        .updateTable('background_jobs')
        .set({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          // See SHUTDOWN_RELEASE_RUN_DELAY_MS: the delay outlives the force-exit backstop, so the
          // zombie handler in this process is dead before any new process can claim the row.
          run_at: new Date(Date.now() + SHUTDOWN_RELEASE_RUN_DELAY_MS),
          attempts: sql<number>`greatest(attempts - 1, 0)`,
          updated_at: new Date(),
        })
        .where('id', 'in', jobIds)
        .where('status', '=', 'processing')
        .execute();
    } catch (err) {
      logger.error({ err, jobIds }, 'Failed to release in-flight jobs during shutdown');
    }
  }

  /**
   * A dead-lettered cron job must still get its next run queued, or the chain stops until the next
   * deploy — silent breakage, since nothing else re-seeds it while the process lives. (For
   * ops_watchdog it's worse than silent: no run means no heartbeat, so /healthz/worker goes stale
   * and alerts until it recovers.) Intervals come from CRON_JOBS so no cron can be forgotten here.
   */
  private async rescheduleCronJobOnFailure(type: string): Promise<void> {
    if (!isCronJobType(type)) return;

    try {
      await scheduleNextRun(this.db, type, CRON_JOBS[type]);
    } catch (schedErr) {
      logger.error({ err: schedErr, type }, 'Failed to reschedule failed cron job');
    }
  }

  private async setupListener() {
    if (!this.isRunning) return;
    try {
      this.pgClient = new Client(env.db);
      await this.pgClient.connect();

      this.pgClient.on('notification', (msg) => {
        if (msg.channel === 'background_jobs_channel') {
          logger.debug('Background Job Worker received notify, waking up...');
          this.wakeUp();
        }
      });

      this.pgClient.on('error', (err) => {
        logger.error({ err }, 'Postgres listener client error');
        this.reconnectListener();
      });

      this.pgClient.on('end', () => {
        logger.warn('Postgres listener connection closed');
        this.reconnectListener();
      });

      await this.pgClient.query('LISTEN background_jobs_channel');
      logger.info('Listening for background_jobs notifications');
    } catch (err) {
      logger.error({ err }, 'Failed to setup Postgres listener');
      this.reconnectListener();
    }
  }

  private wakeUp() {
    // A NOTIFY means work may be waiting — drain the pool right away, superseding any idle backoff.
    this.scheduleDrain(0);
  }
}
