import { Readable } from 'stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { createSigner } from 'fast-jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../../env';
import { BaseRepository } from '../../../lib/base.repo';
import { StorageService } from '../../../lib/storage.service';
import { hashToken } from '../../../lib/token-hash';
import exportsDownloadRoute from './exports-download.route';

/**
 * The download route authenticated the caller and then looked the export up by TENANT ONLY, while
 * the delete path in the same module already required that the caller either created the export or
 * holds a privileged role. `data_exports.id` is a bigint from a sequence, so the ids are
 * enumerable inside a tenant: any member could walk them and pull down a colleague's CSV.
 *
 * The control case matters as much as the denials. Without it, every refusal below could pass
 * simply because the route is broken.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const FILE_BYTES = 'id,email\n1,someone@example.com\n';

describe('exports download route ownership', () => {
  let app: FastifyInstance;
  let tenantId: string;
  let ownerUserId: string;
  let colleagueUserId: string;
  let adminUserId: string;
  let exportId: string;

  /** Creates an authusers row plus an active session, and returns a usable bearer token. */
  async function seedMember(role: string): Promise<{ userId: string; token: string }> {
    const userId = rand();
    const sessionToken = `exports-download-${rand()}`;

    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `member-${userId}@example.com`,
        password: 'not-a-real-hash',
        first_name: 'Export',
        last_name: 'Member',
        verified: true,
        role,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('sessions')
      .values({
        id: rand(),
        session_id: hashToken(sessionToken),
        user_id: userId,
        tenant_id: tenantId,
        ip_address: '127.0.0.1',
        status: 'active',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      })
      .execute();

    const signer = createSigner({ algorithm: 'HS256', key: env.sharedSecret, expiresIn: '1h' });
    const token = signer({ tenant_id: tenantId, user_id: userId, session_id: sessionToken });

    return { userId, token };
  }

  function download(token: string) {
    return app.inject({
      method: 'GET',
      url: `/api/exports/download/${exportId}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  let ownerToken: string;
  let colleagueToken: string;
  let adminToken: string;
  let downloadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(exportsDownloadRoute, { prefix: '/api/exports' });

    // The route streams the blob (downloadStream), never the buffering download().
    downloadSpy = vi.spyOn(StorageService.prototype, 'downloadStream').mockImplementation(async () => ({
      stream: Readable.from([Buffer.from(FILE_BYTES)]),
      contentLength: Buffer.byteLength(FILE_BYTES),
    }));

    tenantId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'Export Download Tenant' }).execute();

    const owner = await seedMember('user');
    const colleague = await seedMember('user');
    const admin = await seedMember('admin');
    ownerUserId = owner.userId;
    colleagueUserId = colleague.userId;
    adminUserId = admin.userId;
    ownerToken = owner.token;
    colleagueToken = colleague.token;
    adminToken = admin.token;

    const exportRow = await db
      .insertInto('data_exports')
      .values({
        tenant_id: tenantId,
        user_id: ownerUserId,
        entity: 'persons',
        file_name: 'persons-export.csv',
        status: 'completed',
        row_count: 1,
        storage_key: `exports/${tenantId}/file.csv`,
        columns: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    exportId = String(exportRow.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await db.deleteFrom('data_exports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('lets the member who requested the export download it', async () => {
    const res = await download(ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(FILE_BYTES);
  });

  it('lets an admin download another member’s export', async () => {
    expect(adminUserId).not.toBe(ownerUserId);

    const res = await download(adminToken);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(FILE_BYTES);
  });

  it('refuses a colleague who neither created it nor holds a privileged role', async () => {
    expect(colleagueUserId).not.toBe(ownerUserId);

    const res = await download(colleagueToken);

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('someone@example.com');
  });

  it('does not read the file from storage for a refused caller', async () => {
    await download(colleagueToken);

    expect(downloadSpy).not.toHaveBeenCalled();
  });
});
