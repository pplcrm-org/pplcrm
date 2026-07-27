import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BaseRepository } from '../../../lib/base.repo';
import { BadRequestError } from '../../../errors/app-errors';
import { buildRawMime, parseRecipientField, saveLocalEmail } from './emails-api.route';

// Integration tests for the outbound-email persistence path.
//
// These run against the real local Postgres so they catch schema-level
// mistakes that mocked unit tests cannot: missing NOT NULL columns
// (createdby_id/updatedby_id) and inserts into columns that don't exist.
describe('saveLocalEmail (integration)', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  let tenantId: string;
  let userId: string;
  let campaignId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant' }).execute();

    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `sender-${userId}@example.com`,
        password: 'password',
        first_name: 'Test',
        last_name: 'Sender',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Emails are campaign-scoped (§15) — saveLocalEmail requires the context id.
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Test Campaign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    // Children first to respect FK constraints, then the email rows.
    const emailIds = (await db.selectFrom('emails').select('id').where('tenant_id', '=', tenantId).execute()).map(
      (r: any) => String(r.id),
    );

    if (emailIds.length > 0) {
      for (const table of ['email_recipients', 'email_attachments', 'email_headers', 'email_bodies']) {
        await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
      }
    }
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('email_attachments').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('persists email, body, headers, and recipients (to/cc/bcc) without attachments', async () => {
    const toList = ['to1@example.com', 'to2@example.com'];
    const ccList = ['cc@example.com'];
    const bccList = ['bcc@example.com'];

    const created = await saveLocalEmail(
      db,
      tenantId,
      campaignId,
      userId,
      'sender@example.com',
      'Test Sender',
      toList,
      ccList,
      bccList,
      'Hello subject',
      '<p>Hello body</p>',
      [],
      'Hello body',
    );

    const emailId = String(created.id);
    expect(emailId).toBeTruthy();
    expect(created.folder_id).toBe('10'); // Outbox

    // Body
    const body = await db
      .selectFrom('email_bodies')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email_id', '=', emailId)
      .executeTakeFirst();
    expect(body?.body_html).toBe('<p>Hello body</p>');

    // Headers
    const headers = await db
      .selectFrom('email_headers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email_id', '=', emailId)
      .executeTakeFirst();
    expect(headers).toBeTruthy();

    // Recipients — this insert was previously missing NOT NULL
    // createdby_id/updatedby_id, which broke every send.
    const recipients = await db
      .selectFrom('email_recipients')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email_id', '=', emailId)
      .execute();
    expect(recipients).toHaveLength(toList.length + ccList.length + bccList.length);

    const byKind = (kind: string) =>
      recipients
        .filter((r: any) => r.kind === kind)
        .map((r: any) => r.email)
        .sort();
    expect(byKind('to')).toEqual([...toList].sort());
    expect(byKind('cc')).toEqual([...ccList].sort());
    expect(byKind('bcc')).toEqual([...bccList].sort());

    // Every recipient row must carry the audit columns.
    for (const r of recipients) {
      expect(String(r.createdby_id)).toBe(userId);
      expect(String(r.updatedby_id)).toBe(userId);
    }
  });

  it('persists attachments into files and email_attachments', async () => {
    const uploadedFiles = [
      {
        filename: 'doc.pdf',
        content_type: 'application/pdf',
        size_bytes: 1234,
        storage_key: `emails/attachments/${rand()}_doc.pdf`,
        sha256_hex: rand() + rand(),
        cid: null,
        is_inline: false,
      },
    ];

    const created = await saveLocalEmail(
      db,
      tenantId,
      campaignId,
      userId,
      'sender@example.com',
      'Test Sender',
      ['to@example.com'],
      [],
      [],
      'With attachment',
      '<p>See attached</p>',
      uploadedFiles,
      'See attached',
    );

    const emailId = String(created.id);

    const attachments = await db
      .selectFrom('email_attachments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email_id', '=', emailId)
      .execute();

    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('doc.pdf');
    expect(attachments[0].content_type).toBe('application/pdf');
    expect(String(attachments[0].createdby_id)).toBe(userId);
    expect(String(attachments[0].updatedby_id)).toBe(userId);

    // The underlying file row must have been created.
    const file = await db
      .selectFrom('files')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('storage_key', '=', uploadedFiles[0].storage_key)
      .executeTakeFirst();
    expect(file).toBeTruthy();
    expect(file?.sha256_hex).toBe(uploadedFiles[0].sha256_hex);

    // The attachment must be linked to that file so downloads can resolve it.
    expect(attachments[0].file_id).toBeTruthy();
    expect(String(attachments[0].file_id)).toBe(String(file?.id));
  });
});

// Recipient lists arrive as JSON strings inside a multipart form and are the only
// user-supplied values in the send path that reach a mail header unencoded. A CR/LF
// there terminates the header and lets the remainder be read as new headers — e.g. a
// hidden `Bcc:` on mail sent through the tenant's own connected mailbox.
describe('parseRecipientField (MIME header injection guard)', () => {
  it('returns an empty list for a missing field', () => {
    expect(parseRecipientField(undefined, 'cc')).toEqual([]);
    expect(parseRecipientField('', 'cc')).toEqual([]);
  });

  it('parses and trims a well-formed list', () => {
    expect(parseRecipientField('[" a@example.com ","b@example.com"]', 'to')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('rejects malformed JSON as a 400 rather than throwing a raw SyntaxError', () => {
    expect(() => parseRecipientField('{not json', 'to')).toThrow(BadRequestError);
  });

  it('rejects a non-array payload (previously threw on .join)', () => {
    expect(() => parseRecipientField('"a@example.com"', 'to')).toThrow(BadRequestError);
    expect(() => parseRecipientField('{"0":"a@example.com"}', 'to')).toThrow(BadRequestError);
  });

  it('rejects a recipient carrying a CRLF header injection', () => {
    const payload = JSON.stringify(['victim@example.com\r\nBcc: attacker@evil.com']);
    expect(() => parseRecipientField(payload, 'to')).toThrow(BadRequestError);
  });

  it('rejects a bare newline injection', () => {
    expect(() => parseRecipientField(JSON.stringify(['a@example.com\nBcc: x@y.com']), 'bcc')).toThrow(BadRequestError);
  });

  it('caps the number of addresses', () => {
    const many = JSON.stringify(Array.from({ length: 101 }, (_, i) => `u${i}@example.com`));
    expect(() => parseRecipientField(many, 'to')).toThrow(BadRequestError);
  });
});

// Second line of defence: even if a caller hands buildRawMime unvalidated strings, a line
// break must never reach the assembled headers.
describe('buildRawMime (header safety)', () => {
  const base = {
    fromName: 'Amira Hassan',
    fromEmail: 'amira@example.com',
    to: ['voter@example.com'],
    cc: [],
    bcc: [],
    subject: 'Hello',
    html: '<p>hi</p>',
    attachments: [],
  };

  it('assembles a normal message', () => {
    const raw = buildRawMime(base).toString('utf-8');
    expect(raw).toContain('To: voter@example.com');
    expect(raw).toContain('From: "Amira Hassan" <amira@example.com>');
  });

  it('throws when a recipient contains a line break', () => {
    expect(() => buildRawMime({ ...base, to: ['a@b.com\r\nBcc: attacker@evil.com'] })).toThrow(BadRequestError);
    expect(() => buildRawMime({ ...base, cc: ['a@b.com\nX-Evil: 1'] })).toThrow(BadRequestError);
    expect(() => buildRawMime({ ...base, bcc: ['a@b.com\rX-Evil: 1'] })).toThrow(BadRequestError);
  });

  it('throws when the sender name or address contains a line break', () => {
    expect(() => buildRawMime({ ...base, fromName: 'Evil\r\nBcc: attacker@evil.com' })).toThrow(BadRequestError);
    expect(() => buildRawMime({ ...base, fromEmail: 'a@b.com>\r\nBcc: attacker@evil.com' })).toThrow(BadRequestError);
  });

  it('base64-encodes the subject, so a line break there cannot reach the headers', () => {
    const raw = buildRawMime({ ...base, subject: 'Hi\r\nBcc: attacker@evil.com' }).toString('utf-8');
    expect(raw).not.toContain('Bcc: attacker@evil.com');
    expect(raw).toContain('Subject: =?utf-8?B?');
  });
});
