import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

vi.mock('../../../../env', () => ({
  env: { opsAlertEmail: 'ops@test' as string | undefined, postmarkFromEmail: 'hello@pplcrm.com' },
}));

// Partial mock: cron-registry.ts imports the interval constants from this module, so only the
// scheduling side effect is stubbed — the real constants flow through.
vi.mock('../reschedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reschedule')>();
  return { ...actual, scheduleNextRun: vi.fn(async () => undefined) };
});

import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import type { SendMailOptions } from '../../mail/transactional-mail.service';
import { StorageService } from '../../storage.service';
import { FIVE_MINUTES_MS, scheduleNextRun } from '../reschedule';
import { handleOpsWatchdog, handleSendBugReportEmail } from './ops.handlers';

/**
 * Minimal Kysely stand-in: each table maps to a QUEUE of results, consumed one per executed
 * query (the watchdog hits background_jobs twice — failed groups, then backlog). Inserts are
 * recorded for heartbeat assertions.
 */
function makeFakeDb(queues: Record<string, unknown[]>) {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const nextResult = (table: string): unknown => (queues[table] ?? []).shift();
  const makeBuilder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    const chain = (): Record<string, unknown> => b;
    for (const m of ['select', 'selectAll', 'where', 'groupBy', 'onConflict']) b[m] = vi.fn(chain);
    b['values'] = vi.fn((values: Record<string, unknown>): Record<string, unknown> => {
      inserts.push({ table, values });
      return b;
    });
    b['execute'] = vi.fn(async () => nextResult(table) ?? []);
    b['executeTakeFirst'] = vi.fn(async () => nextResult(table));
    return b;
  };
  const db = {
    selectFrom: vi.fn((t: string) => makeBuilder(String(t))),
    insertInto: vi.fn((t: string) => makeBuilder(String(t))),
  };
  // The fake only implements the chain surface the handler uses.
  return { db: db as unknown as Kysely<Models>, inserts };
}

const QUIET: Record<string, unknown[]> = {
  ops_heartbeats: [{ details: null }],
  background_jobs: [[], { oldest_run_at: null }],
  webhook_events: [[]],
  tenants: [[]],
};

function withFailures(overrides: Partial<Record<string, unknown[]>> = {}): Record<string, unknown[]> {
  return {
    ops_heartbeats: [{ details: null }],
    background_jobs: [[{ key: 'geocode_household', count: 2, sample_error: 'boom' }], { oldest_run_at: null }],
    webhook_events: [[]],
    tenants: [[]],
    ...overrides,
  };
}

describe('handleOpsWatchdog', () => {
  let sendMail: MockInstance<(options: SendMailOptions) => Promise<void>>;

  beforeEach(() => {
    env.opsAlertEmail = 'ops@test';
    sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('quiet cycle: no email, but the heartbeat beats and the next run is scheduled', async () => {
    const { db, inserts } = makeFakeDb({ ...QUIET });

    await handleOpsWatchdog(db);

    expect(sendMail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe('ops_heartbeats');
    expect(inserts[0]?.values['name']).toBe('ops_watchdog');
    expect(scheduleNextRun).toHaveBeenCalledWith(db, 'ops_watchdog', FIVE_MINUTES_MS);
  });

  it('emails a digest of newly failed jobs and stamps the alert fingerprint', async () => {
    const { db, inserts } = makeFakeDb(withFailures());

    await handleOpsWatchdog(db);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ops@test');
    expect(mail.subject).toContain('2 failed jobs');
    expect(mail.text).toContain('geocode_household');
    expect(mail.text).toContain('boom');

    const details = JSON.parse(String(inserts[0]?.values['details'])) as Record<string, unknown>;
    // :m0 = order-of-magnitude bucket of the count (2 failures → floor(log10(2)) = 0).
    expect(details['last_alert_fingerprint']).toBe('job:geocode_household:m0');
    expect(details['last_alerted_at']).toBeTruthy();
    expect(details['last_checked_at']).toBeTruthy();
  });

  it('suppresses a repeat of the same findings within the suppression window', async () => {
    const { db } = makeFakeDb(
      withFailures({
        ops_heartbeats: [
          {
            details: {
              last_checked_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              last_alert_fingerprint: 'job:geocode_household:m0',
              last_alerted_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            },
          },
        ],
      }),
    );

    await handleOpsWatchdog(db);

    expect(sendMail).not.toHaveBeenCalled();
    expect(scheduleNextRun).toHaveBeenCalled();
  });

  it('re-alerts inside the window when a known category escalates by an order of magnitude', async () => {
    const { db } = makeFakeDb(
      withFailures({
        // Same category as the stored fingerprint, but the count crossed a decade (2 → 200,
        // m0 → m2) — escalation must break through the suppression window.
        background_jobs: [[{ key: 'geocode_household', count: 200, sample_error: 'boom' }], { oldest_run_at: null }],
        ops_heartbeats: [
          {
            details: {
              last_checked_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              last_alert_fingerprint: 'job:geocode_household:m0',
              last_alerted_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            },
          },
        ],
      }),
    );

    await handleOpsWatchdog(db);

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('alerts again when the findings change even inside the window', async () => {
    const { db } = makeFakeDb(
      withFailures({
        ops_heartbeats: [
          {
            details: {
              last_checked_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              last_alert_fingerprint: 'job:some_other_type',
              last_alerted_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            },
          },
        ],
      }),
    );

    await handleOpsWatchdog(db);

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('flags a jammed queue via the oldest runnable pending job', async () => {
    const { db } = makeFakeDb({
      ops_heartbeats: [{ details: null }],
      background_jobs: [[], { oldest_run_at: new Date(Date.now() - 30 * 60 * 1000) }],
      webhook_events: [[]],
      tenants: [[]],
    });

    await handleOpsWatchdog(db);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toContain('queue backlog');
    expect(mail.text).toContain('Queue backlog');
  });

  it('still beats the heartbeat and schedules the next run when the alert email fails, then rethrows', async () => {
    sendMail.mockRejectedValue(new Error('postmark down'));
    const { db, inserts } = makeFakeDb(withFailures());

    await expect(handleOpsWatchdog(db)).rejects.toThrow('postmark down');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe('ops_heartbeats');
    expect(inserts[0]?.values['name']).toBe('ops_watchdog');
    const details = JSON.parse(String(inserts[0]?.values['details'])) as Record<string, unknown>;
    // The fingerprint is NOT stamped on failure — the next cycle re-attempts the alert
    // instead of suppressing it as already-sent.
    expect(details['last_alert_fingerprint']).toBeUndefined();
    expect(details['last_alerted_at']).toBeUndefined();
    expect(details['last_checked_at']).toBeTruthy();
    expect(scheduleNextRun).toHaveBeenCalledWith(db, 'ops_watchdog', FIVE_MINUTES_MS);
  });

  it('still beats the heartbeat when OPS_ALERT_EMAIL is unset (findings only logged)', async () => {
    env.opsAlertEmail = undefined;
    const { db, inserts } = makeFakeDb(withFailures());

    await handleOpsWatchdog(db);

    expect(sendMail).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe('ops_heartbeats');
    expect(scheduleNextRun).toHaveBeenCalled();
  });
});

describe('handleSendBugReportEmail', () => {
  let sendMail: MockInstance<(options: SendMailOptions) => Promise<void>>;

  const PAYLOAD = { type: 'send-bug-report-email', bugReportId: '42', tenant_id: '7' } as const;

  function bugReportRow(overrides: Record<string, unknown> = {}) {
    return {
      id: '42',
      tenant_id: '7',
      created_by: '9',
      description: 'The save button does nothing',
      page_url: '/people/1',
      user_agent: 'TestBrowser/1.0',
      viewport: '1512x982',
      screenshot_file_id: null,
      created_at: new Date('2026-07-24T12:00:00Z'),
      ...overrides,
    };
  }

  const reporterRow = {
    email: 'dana@example.com',
    first_name: 'Dana',
    last_name: 'Tester',
    role: 'admin',
    campaign_id: null,
  };

  beforeEach(() => {
    env.opsAlertEmail = 'ops@test';
    sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('emails the report with reference, reporter, and context (no screenshot)', async () => {
    const { db } = makeFakeDb({
      bug_reports: [bugReportRow()],
      authusers: [reporterRow],
      tenants: [{ name: 'Acme Campaign' }],
    });

    await handleSendBugReportEmail(PAYLOAD, db);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ops@test');
    expect(mail.subject).toBe('pplCRM bug report BR-42 (tenant 7)');
    expect(mail.text).toContain('The save button does nothing');
    expect(mail.text).toContain('Dana Tester <dana@example.com>');
    expect(mail.text).toContain('Acme Campaign');
    expect(mail.text).toContain('Screenshot: none');
    expect(mail.attachments).toEqual([]);
  });

  it('falls back to the Postmark from-address when OPS_ALERT_EMAIL is unset', async () => {
    env.opsAlertEmail = undefined;
    const { db } = makeFakeDb({
      bug_reports: [bugReportRow()],
      authusers: [reporterRow],
      tenants: [{ name: 'Acme Campaign' }],
    });

    await handleSendBugReportEmail(PAYLOAD, db);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('hello@pplcrm.com');
  });

  it('attaches the screenshot downloaded from storage', async () => {
    vi.spyOn(StorageService.prototype, 'download').mockResolvedValue(Buffer.from('fake-image-bytes'));
    const { db } = makeFakeDb({
      bug_reports: [bugReportRow({ screenshot_file_id: '55' })],
      authusers: [reporterRow],
      tenants: [{ name: 'Acme Campaign' }],
      files: [{ filename: 'shot.png', mime_type: 'image/png', size_bytes: 1234, storage_key: 'k/shot.png' }],
    });

    await handleSendBugReportEmail(PAYLOAD, db);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.attachments).toEqual([
      {
        name: 'shot.png',
        contentBase64: Buffer.from('fake-image-bytes').toString('base64'),
        contentType: 'image/png',
      },
    ]);
    expect(mail.text).toContain('Screenshot: attached (shot.png)');
  });

  it('still sends (with a note) when the screenshot is too large to attach', async () => {
    const download = vi.spyOn(StorageService.prototype, 'download');
    const { db } = makeFakeDb({
      bug_reports: [bugReportRow({ screenshot_file_id: '55' })],
      authusers: [reporterRow],
      tenants: [{ name: 'Acme Campaign' }],
      files: [{ filename: 'huge.png', mime_type: 'image/png', size_bytes: 8 * 1024 * 1024, storage_key: 'k/huge.png' }],
    });

    await handleSendBugReportEmail(PAYLOAD, db);

    expect(download).not.toHaveBeenCalled();
    const mail = sendMail.mock.calls[0][0];
    expect(mail.attachments).toEqual([]);
    expect(mail.text).toContain('too large to attach');
  });

  it('skips quietly when the report row no longer exists', async () => {
    const { db } = makeFakeDb({ bug_reports: [] });

    await handleSendBugReportEmail(PAYLOAD, db);

    expect(sendMail).not.toHaveBeenCalled();
  });
});
