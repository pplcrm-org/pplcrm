import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { pauseTenantSending } from '../../../modules/newsletters/send-guards';
import type { EmailVerificationSummary } from '../../mail/email-verifier.service';
import {
  classifyEmails,
  EmailVerifierService,
  evaluateImportListQuality,
  domainOfEmail,
} from '../../mail/email-verifier.service';

/** Same loose syntax gate sanitizeRow uses — a row's email is blanked upstream if it fails this. */
const EMAIL_SYNTAX = /.+@.+\..+/;
/** Postgres `IN (...)` list size for the already-suppressed lookup. */
const SUPPRESSION_LOOKUP_CHUNK = 1_000;
/** Suppression insert batch size. */
const SUPPRESSION_INSERT_CHUNK = 500;
/** Pause reason prefix; the import id is appended so support can trace which import triggered it. */
export const IMPORT_PAUSE_REASON = 'import_bad_email_rate';

interface ImportRowEmails {
  email?: string;
  email2?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Typo-suspect entries kept on a MERGED summary — same bound the per-segment classifier uses. */
const MERGED_TYPO_SUSPECT_CAP = 25;

/** Narrow a stored `data_imports.email_verification` value back to a summary, or null. */
function parseStoredSummary(value: unknown): EmailVerificationSummary | null {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidate = parsed as Partial<EmailVerificationSummary>;
  if (typeof candidate.checked !== 'number') return null;
  return {
    checked: candidate.checked,
    valid: candidate.valid ?? 0,
    dead_domain: candidate.dead_domain ?? 0,
    disposable: candidate.disposable ?? 0,
    already_suppressed: candidate.already_suppressed ?? 0,
    unverifiable: candidate.unverifiable ?? 0,
    role_accounts: candidate.role_accounts ?? 0,
    suppressed_new: candidate.suppressed_new ?? 0,
    typo_suspects: Array.isArray(candidate.typo_suspects) ? candidate.typo_suspects : [],
    tripwire: candidate.tripwire === 'pause' || candidate.tripwire === 'warn' ? candidate.tripwire : 'none',
  };
}

/**
 * Fold one segment's verification summary into what earlier segments already stored. A large
 * import runs as a chain of continuation jobs and each run verifies only the emails IT fed, so
 * without this the stored summary (and the completion email built from it) reflected only the
 * LAST segment. Counts add; typo suspects concatenate (de-duplicated by email, bounded); the
 * tripwire keeps the most severe verdict any segment reached (pause > warn > none).
 */
export function mergeEmailVerificationSummaries(
  prior: EmailVerificationSummary | null,
  segment: EmailVerificationSummary,
): EmailVerificationSummary {
  if (!prior) return segment;
  const seen = new Set(prior.typo_suspects.map((t) => t.email));
  const typos = [...prior.typo_suspects];
  for (const t of segment.typo_suspects) {
    if (typos.length >= MERGED_TYPO_SUSPECT_CAP) break;
    if (!seen.has(t.email)) {
      seen.add(t.email);
      typos.push(t);
    }
  }
  const tripwires = [prior.tripwire, segment.tripwire];
  return {
    checked: prior.checked + segment.checked,
    valid: prior.valid + segment.valid,
    dead_domain: prior.dead_domain + segment.dead_domain,
    disposable: prior.disposable + segment.disposable,
    already_suppressed: prior.already_suppressed + segment.already_suppressed,
    unverifiable: prior.unverifiable + segment.unverifiable,
    role_accounts: prior.role_accounts + segment.role_accounts,
    suppressed_new: prior.suppressed_new + segment.suppressed_new,
    typo_suspects: typos,
    tripwire: tripwires.includes('pause') ? 'pause' : tripwires.includes('warn') ? 'warn' : 'none',
  };
}

/** Unique, lowercased, syntactically-valid emails drawn from the import rows' email + email2 columns. */
function uniqueEmailsFromRows(rows: ImportRowEmails[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const raw of [row.email, row.email2]) {
      if (typeof raw !== 'string') continue;
      const email = raw.trim().toLowerCase();
      if (email && EMAIL_SYNTAX.test(email)) set.add(email);
    }
  }
  return [...set];
}

/**
 * Verifies the imported email list (DNS + disposable), suppresses proven-bad addresses, records the
 * summary on data_imports, and — on an egregious bad-email rate — pauses the tenant's sending.
 *
 * Suppression is additive and idempotent: bad addresses stay on the person record, but a new
 * `invalid` row in email_suppressions excludes them from every send (the sendability and automation
 * consent checks are reason-agnostic existence checks).
 *
 * Returns the summary, or null if verification failed — callers treat null as "import completed,
 * no verification numbers". Verification must never fail the import (fail-open).
 */
export async function runImportEmailVerification(
  db: Kysely<Models>,
  payload: { tenant_id: string; import_id: string; user_id: string },
  rows: ImportRowEmails[],
  verifier: EmailVerifierService = new EmailVerifierService(),
): Promise<EmailVerificationSummary | null> {
  try {
    const emails = uniqueEmailsFromRows(rows);
    if (emails.length === 0) return null;

    // 1. Addresses this tenant already suppresses (any reason — the checks are reason-agnostic).
    const alreadySuppressed = new Set<string>();
    for (const batch of chunk(emails, SUPPRESSION_LOOKUP_CHUNK)) {
      const existing = await db
        .selectFrom('email_suppressions')
        .select('email')
        .where('tenant_id', '=', payload.tenant_id)
        .where('email', 'in', batch)
        .execute();
      for (const row of existing) alreadySuppressed.add(row.email.toLowerCase());
    }

    // 2. Resolve every unique domain (cached, bounded, fail-open), then classify each address.
    const domains = emails.map((e) => domainOfEmail(e)).filter((d): d is string => d != null);
    const domainStatus = await verifier.verifyDomains(domains);
    const { summary, toSuppress } = classifyEmails(emails, domainStatus, alreadySuppressed);

    // 3. Suppress the proven-bad addresses (idempotent — safe on a re-run).
    for (const batch of chunk(toSuppress, SUPPRESSION_INSERT_CHUNK)) {
      await db
        .insertInto('email_suppressions')
        .values(batch.map((email) => ({ tenant_id: payload.tenant_id, email, reason: 'invalid' })))
        .onConflict((oc) => oc.columns(['tenant_id', 'email', 'reason']).doNothing())
        .execute();
    }

    // 4. Decide the list-quality tripwire and stamp it onto the summary.
    const outcome = evaluateImportListQuality({
      checked: summary.checked,
      dead: summary.dead_domain,
      disposable: summary.disposable,
    });
    const full: EmailVerificationSummary = {
      ...summary,
      tripwire: outcome === 'pause' ? 'pause' : outcome === 'warn' ? 'warn' : 'none',
    };

    // 5. Persist the summary for the completion email and the History page — MERGED into what
    // earlier segments of a continued/resumed import already stored, so a multi-segment run
    // (normal at the 100,000-row cap) reports the whole file, not just the last segment.
    // A crash between a segment's verification and its cursor write can re-verify that
    // segment's tail and count those emails twice — accepted: the summary is informative,
    // and suppression inserts stay idempotent.
    const storedRow = await db
      .selectFrom('data_imports')
      .select('email_verification')
      .where('id', '=', payload.import_id)
      .where('tenant_id', '=', payload.tenant_id)
      .executeTakeFirst();
    const merged = mergeEmailVerificationSummaries(parseStoredSummary(storedRow?.email_verification), full);
    await db
      .updateTable('data_imports')
      .set({ email_verification: JSON.stringify(merged) })
      .where('id', '=', payload.import_id)
      .where('tenant_id', '=', payload.tenant_id)
      .execute();

    // 6. Act on the tripwire.
    if (outcome === 'pause') {
      logger.error(
        { tenantId: payload.tenant_id, importId: payload.import_id, summary: full },
        '[abuse-tripwire] Import bad-email rate exceeded — tenant sending paused',
      );
      await pauseTenantSending(db, payload.tenant_id, `${IMPORT_PAUSE_REASON}:${payload.import_id}`);
    } else if (outcome === 'warn') {
      logger.warn(
        { tenantId: payload.tenant_id, importId: payload.import_id, summary: full },
        '[abuse-tripwire] Import bad-email rate elevated',
      );
    }

    // The merged whole-import summary, so the completion email reports every segment.
    return merged;
  } catch (err) {
    logger.error({ err, importId: payload.import_id }, 'Import email verification failed (import unaffected)');
    return null;
  }
}
