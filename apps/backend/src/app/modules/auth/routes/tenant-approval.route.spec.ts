import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { TransactionalEmailService } from '../../../lib/mail/transactional-mail.service';
import { mintApprovalToken } from '../tenant-approval';
import tenantApprovalRoute from './tenant-approval.route';

/**
 * The ops end of the closed-beta gate. The contract this pins:
 *  - GET never decides. Link scanners and inbox previews issue GETs on every URL in an email,
 *    and a GET that approved would let a mail scanner admit every signup that lands.
 *  - POST decides, arrives as application/x-www-form-urlencoded, and spends the token, so a
 *    replayed or double-submitted link reports "already decided" instead of re-deciding.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ routerOptions: { maxParamLength: 1024 } });
  await app.register(tenantApprovalRoute, { prefix: '/api/tenant-approval' });
  return app;
}

describe('tenant approval route (ops link)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;

  let app: FastifyInstance;
  let tenantId: string;
  let userId: string;
  let token: string;
  let sendMail: ReturnType<typeof vi.spyOn>;

  async function approvalStatus(): Promise<{ approval_status: string; approval_token_hash: string | null }> {
    return db
      .selectFrom('tenants')
      .select(['approval_status', 'approval_token_hash'])
      .where('id', '=', tenantId)
      .executeTakeFirstOrThrow();
  }

  beforeEach(async () => {
    app = await buildApp();
    // The approval mail is a side effect, not the subject; keep it off the wire.
    sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    tenantId = rand();
    userId = rand();
    const minted = mintApprovalToken();
    token = minted.token;

    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: 'Riverside Ward Association',
        approval_status: 'pending',
        approval_requested_at: new Date(),
        approval_token_hash: minted.tokenHash,
      })
      .execute();

    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `owner-${userId}@example.com`,
        password: 'not-a-real-hash',
        first_name: 'Jordan',
        last_name: 'Owner',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .updateTable('tenants')
      .set({ admin_id: userId, createdby_id: userId })
      .where('id', '=', tenantId)
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('renders the decision page on GET without deciding anything', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tenant-approval/${token}` });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Riverside Ward Association');
    expect(res.body).toContain('Approve');
    expect(res.body).toContain('Decline');
    // The whole point: a prefetching mail scanner must not have admitted anyone.
    expect((await approvalStatus()).approval_status).toBe('pending');
  });

  it('404s an unknown or spent token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tenant-approval/${mintApprovalToken().token}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('not valid');
  });

  it('approves on POST, spends the token, and emails the owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tenant-approval/${token}`,
      payload: 'decision=approve',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Approved');

    const tenant = await approvalStatus();
    expect(tenant.approval_status).toBe('approved');
    expect(tenant.approval_token_hash).toBeNull();

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `owner-${userId}@example.com`,
        subject: 'Your pplCRM workspace is ready',
      }),
    );
  });

  it('declines on POST without emailing the owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tenant-approval/${token}`,
      payload: 'decision=decline',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Declined');
    expect((await approvalStatus()).approval_status).toBe('declined');
    expect(sendMail).not.toHaveBeenCalled();
  });

  // Fails safe: a POST that somehow loses its body must not read as an approval.
  it('treats a missing decision as a decline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tenant-approval/${token}`,
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(200);
    expect((await approvalStatus()).approval_status).toBe('declined');
  });

  it('reports "already decided" on a replayed link instead of deciding again', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/tenant-approval/${token}`,
      payload: 'decision=approve',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: `/api/tenant-approval/${token}`,
      payload: 'decision=decline',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    // The token was spent by the first decision, so the replay resolves to nothing at all.
    expect(replay.statusCode).toBe(404);
    expect((await approvalStatus()).approval_status).toBe('approved');
  });
});
