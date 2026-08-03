import crypto from 'node:crypto';
import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { DonationReceiptsController } from '../../../modules/donations/receipts/controller';
import { ReceiptsRepo, type ReceiptRow } from '../../../modules/donations/repositories/receipts.repo';
import { logger } from '../../../logger';
import { buildStatementPdf } from '../../pdf/statement-pdf';
import { TransactionalEmailService, type MailAttachment } from '../../mail/transactional-mail.service';
import { TransactionalSendBlockedError } from '../../mail/transactional-send-guard';
import { StorageService } from '../../storage.service';
import { notificationEnabled } from '../../profile-preferences';
import type { JobPayloadOf } from '../job-payloads';

/**
 * Donation-document jobs: acknowledge a gift the moment it commits, render + email one document,
 * and the year-end batch. All PDF and mail work lives here in the worker — attachments only exist
 * on the direct sendMail path, and payment webhooks / tRPC mutations must never wait on (or fail
 * because of) a PDF.
 */

/** Donors handled per execution before yielding the worker slot (newsletter-batch rationale). */
const STATEMENT_BATCH_DONORS = 50;
/** Continuation delay when the hourly contact-mail cap blocks a send (rolling window frees up). */
const RATE_CAP_DEFER_MS = 20 * 60 * 1000;

const mailService = new TransactionalEmailService({ defaultAudience: 'contact' });

// ── Acknowledge a gift ──────────────────────────────────────────────────────

export async function handleIssueDonationAcknowledgement(
  job: JobPayloadOf<'issue-donation-acknowledgement'>,
): Promise<void> {
  const controller = new DonationReceiptsController();
  const { receipt, skipped } = await controller.issueAcknowledgement(job.tenant_id, job.donation_id, job.user_id);
  if (receipt) {
    logger.info(
      { tenantId: job.tenant_id, donationId: job.donation_id, number: receipt.receipt_number },
      'Acknowledged donation',
    );
  } else {
    // Deliberately success, not failure: the reasons an acknowledgement is skipped (gift reversed,
    // no donor linked) are not fixed by retrying.
    logger.info({ tenantId: job.tenant_id, donationId: job.donation_id, skipped }, 'Acknowledgement skipped');
  }
}

// ── Render + deliver one document ───────────────────────────────────────────

function receiptFilename(receipt: ReceiptRow): string {
  if (receipt.kind === 'statement') return `Giving-statement-${receipt.year}.pdf`;
  const number = (receipt.receipt_number ?? String(receipt.id)).replace(/[^A-Za-z0-9-]/g, '');
  return receipt.kind === 'acknowledgement' ? `Donation-receipt-${number}.pdf` : `Receipt-${number}.pdf`;
}

async function buildPdf(
  controller: DonationReceiptsController,
  tenantId: string,
  receipt: ReceiptRow,
): Promise<Buffer> {
  if (receipt.kind === 'acknowledgement') return controller.buildPdfForAcknowledgement(tenantId, receipt);
  if (receipt.kind !== 'statement') return controller.buildPdfForReceipt(tenantId, receipt);

  const issuer = (
    receipt.issuer_snapshot && typeof receipt.issuer_snapshot === 'object' ? receipt.issuer_snapshot : {}
  ) as { org_legal_name?: string; org_address?: string };
  return buildStatementPdf({
    year: receipt.year,
    orgName: issuer.org_legal_name ?? '',
    orgAddress: issuer.org_address,
    donorName: receipt.donor_name,
    donorAddressLines: [
      [receipt.donor_address_line1, receipt.donor_address_line2].filter(Boolean).join(', '),
      [receipt.donor_city, receipt.donor_province, receipt.donor_postal_code].filter(Boolean).join(', '),
      receipt.donor_country ?? '',
    ].filter((line) => line.trim().length > 0),
    gifts: await controller.getStatementGifts(tenantId, receipt.id),
    totalCents: receipt.amount_cents,
    generatedAt: new Date(receipt.issued_at),
  });
}

/** Donor-facing subject and opening line, by document kind. */
function donorMailCopy(receipt: ReceiptRow, orgName: string): { subject: string; intro: string } {
  switch (receipt.kind) {
    case 'statement':
      return {
        subject: `Your ${receipt.year} giving statement from ${orgName}`,
        intro: `Attached is your giving statement for ${receipt.year} — a summary of your gifts to ${orgName}.`,
      };
    case 'acknowledgement':
      return {
        subject: `Your donation receipt from ${orgName}`,
        intro:
          `Thank you for your gift to ${orgName}. Your receipt ${receipt.receipt_number ?? ''} is attached. ` +
          'It is not an official receipt for income tax purposes.',
      };
    default:
      return {
        subject: `Your official tax receipt from ${orgName}`,
        intro: `Thank you for your gift to ${orgName}. Your official receipt ${receipt.receipt_number ?? ''} is attached.`,
      };
  }
}

/**
 * Idempotent render-then-email for one document: a retry re-enters wherever it left off (file
 * exists → skip to email; emailed_at set → done). Returns what happened; rethrows
 * TransactionalSendBlockedError so the caller can decide between deferring and dropping.
 */
export async function renderAndDeliverReceipt(
  db: Kysely<Models>,
  tenantId: string,
  receiptId: string,
  opts: { email: boolean; userId: string | null },
): Promise<'emailed' | 'stored' | 'missing'> {
  const controller = new DonationReceiptsController();
  const repo = new ReceiptsRepo();
  const receipt = await repo.getReceiptById(tenantId, receiptId);
  if (!receipt) return 'missing';

  let current = receipt;
  if (!current.file_id) {
    const pdf = await buildPdf(controller, tenantId, current);
    const storage = new StorageService();
    const storageKey = `receipts/${tenantId}/${crypto.randomUUID()}.pdf`;
    await storage.upload(storageKey, pdf, 'application/pdf');
    const fileRow = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: receiptFilename(current),
        mime_type: 'application/pdf',
        size_bytes: pdf.length,
        storage_key: storageKey,
        sha256_hex: crypto.createHash('sha256').update(pdf).digest('hex'),
        uploaded_by: opts.userId ?? current.createdby_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await repo.setFile(tenantId, receiptId, String(fileRow.id));
    current = { ...current, file_id: String(fileRow.id) };
  }

  if (!opts.email || current.emailed_at || !current.donor_email) return 'stored';

  const pdf = await buildPdf(controller, tenantId, current);
  const attachment: MailAttachment = {
    name: receiptFilename(current),
    contentBase64: pdf.toString('base64'),
    contentType: 'application/pdf',
  };
  const issuer = (
    current.issuer_snapshot && typeof current.issuer_snapshot === 'object' ? current.issuer_snapshot : {}
  ) as { org_legal_name?: string };
  const orgName = issuer.org_legal_name || 'the organization';
  const { subject, intro } = donorMailCopy(current, orgName);

  await mailService.sendMail({
    to: current.donor_email,
    subject,
    text: `${intro}\n\nThe document is attached as a PDF.`,
    html: `<p>${intro}</p><p>The document is attached as a PDF.</p>`,
    tenant_id: tenantId,
    audience: 'contact',
    attachments: [attachment],
  });
  await repo.markEmailed(tenantId, receiptId);
  return 'emailed';
}

export async function handleRenderReceiptPdf(
  job: JobPayloadOf<'render-receipt-pdf'>,
  db: Kysely<Models>,
): Promise<void> {
  try {
    const outcome = await renderAndDeliverReceipt(db, job.tenant_id, job.receipt_id, {
      email: job.email,
      userId: job.user_id ?? null,
    });
    logger.info({ tenantId: job.tenant_id, receiptId: job.receipt_id, outcome }, 'Receipt PDF render job finished');
  } catch (err) {
    if (err instanceof TransactionalSendBlockedError) {
      const receipt = await new ReceiptsRepo().getReceiptById(job.tenant_id, job.receipt_id);
      // Acknowledgements are the exception to the guard's drop-don't-retry contract. A donor who
      // gives online and hears nothing back assumes the payment failed, so a send blocked by the
      // ROLLING hourly cap is retried once the window moves. A send blocked because the workspace
      // is suspended or paused is not a rolling condition and is still dropped — the PDF is stored
      // either way, so staff can always download and send it by hand.
      if (receipt?.kind === 'acknowledgement' && err.reason === 'rate_capped') {
        await db
          .insertInto('background_jobs')
          .values({
            tenant_id: job.tenant_id,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify(job),
            run_at: new Date(Date.now() + RATE_CAP_DEFER_MS),
            max_attempts: 3,
          })
          .execute();
        logger.warn(
          { tenantId: job.tenant_id, receiptId: job.receipt_id },
          'Acknowledgement email hit the hourly cap — deferred',
        );
        return;
      }
      // Guard contract: drop, don't retry — the PDF is stored; staff can download and send it.
      logger.warn({ tenantId: job.tenant_id, receiptId: job.receipt_id, err: err.message }, 'Receipt email withheld');
      return;
    }
    throw err;
  }
}

// ── Year-end statement batch ────────────────────────────────────────────────

async function updateRunCounters(
  db: Kysely<Models>,
  tenantId: string,
  runId: string,
  set: Partial<{
    cursor_person_id: string | null;
    generated_count: number;
    official_count: number;
    emailed_count: number;
    skipped_no_email: number;
    failed_count: number;
    status: string;
    error: string | null;
  }>,
): Promise<void> {
  await db
    .updateTable('receipt_statement_runs')
    .set({ ...set, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', runId)
    .execute();
}

async function enqueueContinuation(
  db: Kysely<Models>,
  job: JobPayloadOf<'run-year-end-statements'>,
  cursor: string | null,
  delayMs: number,
): Promise<void> {
  await db
    .insertInto('background_jobs')
    .values({
      tenant_id: job.tenant_id,
      queue: 'default',
      status: 'pending',
      payload: JSON.stringify({ ...job, cursor }),
      run_at: new Date(Date.now() + delayMs),
      max_attempts: 3,
    })
    .execute();
}

/**
 * Year-end documents generated but not yet emailed (donor has an email) — heals cap-interrupted
 * donors. Covers both kinds the run produces: a cap can interrupt after a tax receipt is written
 * just as easily as after a summary.
 */
async function emailPendingStatements(
  db: Kysely<Models>,
  tenantId: string,
  year: number,
  userId: string,
): Promise<number> {
  const pending = await db
    .selectFrom('donation_receipts')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('kind', 'in', ['statement', 'cumulative'])
    .where('year', '=', year)
    .where('status', '=', 'issued')
    .where('emailed_at', 'is', null)
    .where('donor_email', 'is not', null)
    .limit(STATEMENT_BATCH_DONORS)
    .execute();
  let emailed = 0;
  for (const row of pending) {
    const outcome = await renderAndDeliverReceipt(db, tenantId, String(row.id), { email: true, userId });
    if (outcome === 'emailed') emailed += 1;
  }
  return emailed;
}

export async function handleRunYearEndStatements(
  job: JobPayloadOf<'run-year-end-statements'>,
  db: Kysely<Models>,
): Promise<void> {
  const tenantId = job.tenant_id;
  const controller = new DonationReceiptsController();
  const repo = new ReceiptsRepo();

  const run = await db
    .selectFrom('receipt_statement_runs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', job.run_id)
    .executeTakeFirst();
  if (!run || run.status !== 'running') return; // cancelled or already finished

  // A paused/suspended tenant cannot email donors; fail the run visibly instead of stalling.
  const tenant = await db
    .selectFrom('tenants')
    .select(['suspended_at', 'sending_paused_at'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (tenant?.suspended_at || tenant?.sending_paused_at) {
    await updateRunCounters(db, tenantId, job.run_id, {
      status: 'failed',
      error: tenant.suspended_at
        ? 'Workspace is suspended — statements cannot be emailed.'
        : 'Sending is paused for this workspace — resolve the pause, then rerun.',
    });
    return;
  }

  const counters = {
    generated: run.generated_count,
    official: run.official_count,
    emailed: run.emailed_count,
    skippedNoEmail: run.skipped_no_email,
    failed: run.failed_count,
  };
  let cursor = job.cursor ?? run.cursor_person_id ?? null;

  // Whether this workspace can issue official tax receipts at all, decided ONCE for the execution:
  // the check reads every receipts.* setting, and per donor it would repeat that read for the whole
  // workspace. Null means every donor gets a giving summary instead, which is the right document
  // for a workspace that issues no tax receipts.
  const issuanceSettings = await controller.cumulativeIssuanceSettings(tenantId);

  try {
    // First, deliver documents a previous execution generated but could not email (cap hit).
    counters.emailed += await emailPendingStatements(db, tenantId, job.year, job.user_id);

    const donors = await repo.listStatementDonors(tenantId, job.year, cursor, STATEMENT_BATCH_DONORS);
    for (const { person_id } of donors) {
      try {
        const receipt = await controller.generateYearEndDocumentForDonor(
          tenantId,
          person_id,
          job.year,
          job.user_id,
          issuanceSettings,
        );
        if (receipt) {
          counters.generated += 1;
          if (receipt.kind === 'cumulative') counters.official += 1;
          const outcome = await renderAndDeliverReceipt(db, tenantId, receipt.id, {
            email: true,
            userId: job.user_id,
          });
          if (outcome === 'emailed') counters.emailed += 1;
          else if (!receipt.donor_email) counters.skippedNoEmail += 1;
        }
      } catch (err) {
        if (err instanceof TransactionalSendBlockedError) throw err; // handled below — defer
        counters.failed += 1;
        logger.error({ err, tenantId, personId: person_id, year: job.year }, 'Year-end document failed for donor');
      }
      cursor = person_id;
      await updateRunCounters(db, tenantId, job.run_id, {
        cursor_person_id: cursor,
        generated_count: counters.generated,
        official_count: counters.official,
        emailed_count: counters.emailed,
        skipped_no_email: counters.skippedNoEmail,
        failed_count: counters.failed,
      });
    }

    if (donors.length === STATEMENT_BATCH_DONORS) {
      await enqueueContinuation(db, job, cursor, 0);
      return;
    }
  } catch (err) {
    if (err instanceof TransactionalSendBlockedError) {
      // Hourly contact cap: progress is already persisted per donor; resume when the window rolls.
      logger.warn({ tenantId, year: job.year }, 'Statement run hit the hourly mail cap — deferring');
      await updateRunCounters(db, tenantId, job.run_id, {
        cursor_person_id: cursor,
        generated_count: counters.generated,
        official_count: counters.official,
        emailed_count: counters.emailed,
        skipped_no_email: counters.skippedNoEmail,
        failed_count: counters.failed,
      });
      await enqueueContinuation(db, job, cursor, RATE_CAP_DEFER_MS);
      return;
    }
    throw err;
  }

  // Recount the print pile from the table rather than trusting increments across continuations.
  const noEmail = await db
    .selectFrom('donation_receipts')
    .select(({ fn }) => [fn.countAll<string | number>().as('total')])
    .where('tenant_id', '=', tenantId)
    .where('kind', 'in', ['statement', 'cumulative'])
    .where('year', '=', job.year)
    .where('status', '=', 'issued')
    .where('donor_email', 'is', null)
    .executeTakeFirst();
  counters.skippedNoEmail = Number(noEmail?.total ?? 0);

  await updateRunCounters(db, tenantId, job.run_id, {
    status: 'completed',
    cursor_person_id: null,
    generated_count: counters.generated,
    official_count: counters.official,
    emailed_count: counters.emailed,
    skipped_no_email: counters.skippedNoEmail,
    failed_count: counters.failed,
  });

  await notifyRunComplete(db, tenantId, job, counters);
}

async function notifyRunComplete(
  db: Kysely<Models>,
  tenantId: string,
  job: JobPayloadOf<'run-year-end-statements'>,
  counters: { generated: number; official: number; emailed: number; skippedNoEmail: number; failed: number },
): Promise<void> {
  try {
    const user = await db
      .selectFrom('authusers')
      .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
      .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
      .where('authusers.id', '=', job.user_id)
      .executeTakeFirst();
    if (!user) return;

    const summaries = counters.generated - counters.official;
    const summary =
      `${counters.official} official tax receipts and ${summaries} giving summaries generated, ` +
      `${counters.emailed} emailed` +
      (counters.skippedNoEmail > 0 ? `, ${counters.skippedNoEmail} to print (no email on file)` : '') +
      (counters.failed > 0 ? `, ${counters.failed} failed` : '') +
      '.';

    if (notificationEnabled(user.profile_preferences, 'statements_ready_in_app')) {
      const { NotificationsRepo } = await import('../../../modules/notifications/repositories/notifications.repo');
      await new NotificationsRepo().pushNotification({
        tenant_id: tenantId,
        user_id: job.user_id,
        title: `${job.year} statements ready`,
        message: summary,
        type: 'export',
        link: '/donations/receipts',
      });
    }

    if (notificationEnabled(user.profile_preferences, 'statements_ready') && user.email) {
      // Staff notice about the batch — not donor mail.
      const staffMail = new TransactionalEmailService({ defaultAudience: 'staff' });
      await staffMail.sendMail({
        to: user.email,
        subject: `Your ${job.year} giving statements are ready`,
        notificationSettingsLink: true,
        tenant_id: tenantId,
        text: `Hi ${user.first_name || 'there'},\n\n${summary}\n\nReview and download them under Donations → Receipts: ${env.appUrl}/donations/receipts`,
        html: `<h2>${job.year} giving statements</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>${summary}</p>
<div class="btn-container"><a href="${env.appUrl}/donations/receipts" class="btn">Review statements</a></div>`,
      });
    }
  } catch (err) {
    logger.error({ err, tenantId, runId: job.run_id }, 'Failed to notify statement-run completion');
  }
}
