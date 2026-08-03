import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';
import { hashToken } from '../../lib/token-hash';
import { HouseholdsRouter } from './trpc.router';
import { PersonsRouter } from '../persons/trpc.router';
import { IMPORTED_AREA_SETS } from './electoral-areas';
import { ELECTORAL_IMPORT_ROW_FIELDS } from './electoral-import-schema';

/**
 * The bug this file exists to prevent: both import endpoints validate each CSV row against a Zod
 * object, and a Zod object silently DROPS every key it does not name. So a district column the
 * wizard mapped and sent was discarded at the network boundary, the request still succeeded, and
 * the districts simply never arrived. Nothing failed and nothing was logged.
 *
 * Service-level tests cannot catch that, because they call the service directly and never cross the
 * boundary. These tests go through `createCaller`, which runs the real authentication middleware
 * and the real input schema, and then read the payload the endpoint actually stored for the
 * background job. If the schema stops naming these columns, the stored payload loses them and these
 * tests fail.
 */
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);
const db = BaseRepository.dbInstance;

/** A voter file's district columns, as the import wizard sends them. */
const DISTRICT_COLUMNS = {
  electoral_district: 'Ottawa Centre',
  congressional_district: 'OH-3',
  legislative_district: '18',
  state_house_district: '21',
  state_senate_district: '15',
  ward: 'Ward 5',
  precinct: 'Precinct 12',
};

describe('electoral import columns survive the request boundary', () => {
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let sessionToken: string;
  /** Every NDJSON payload the endpoint stored for the background job, newest last. */
  let storedPayloads: string[];

  /**
   * The tRPC context a signed-in request carries. `res` is stubbed because the households import
   * endpoint sets the HTTP 202 status on it directly.
   */
  function ctx(): {
    auth: { tenant_id: string; user_id: string; session_id: string };
    res: { status: (code: number) => void };
  } {
    return {
      auth: { tenant_id: tenantId, user_id: userId, session_id: sessionToken },
      res: { status: (): void => undefined },
    };
  }

  /** The row objects the endpoint queued for the background job to read back. */
  function queuedRows(): Array<Record<string, unknown>> {
    const payload = storedPayloads[storedPayloads.length - 1] ?? '';
    return payload
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    sessionToken = `session-${rand()}`;
    storedPayloads = [];

    vi.spyOn(StorageService.prototype, 'upload').mockImplementation(
      async (_key: string, body: Buffer, contentType?: string): Promise<void> => {
        // Only the row payload, never the retained copy of the original CSV upload.
        if (contentType !== 'text/csv') storedPayloads.push(body.toString('utf8'));
      },
    );

    await db.insertInto('tenants').values({ id: tenantId, name: 'Voter File Boundary Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `organizer-${userId}@example.com`,
        first_name: 'Organizer',
        last_name: 'Person',
        verified: true,
        role: 'admin',
        password: 'argon2id$not-a-real-hash',
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
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        name: 'Ohio 3rd',
        admin_id: userId,
        kind: 'office',
        jurisdiction: 'us_federal',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    // The People import resolves the workspace's current campaign from settings before it stores
    // anything, so a workspace without this row cannot import at all.
    await db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        key: 'current_campaign',
        value: JSON.stringify(campaignId),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('data_imports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
    await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('keeps every district column on a People import request', async () => {
    const caller = PersonsRouter.createCaller(ctx());

    await caller.import({
      rows: [{ first_name: 'Ada', last_name: 'Lovelace', street1: 'Evergreen Terrace', ...DISTRICT_COLUMNS }],
      file_name: 'voterfile.csv',
    });

    expect(queuedRows()[0]).toMatchObject(DISTRICT_COLUMNS);
  });

  it('keeps every district column on a Households import request', async () => {
    const caller = HouseholdsRouter.createCaller(ctx());

    await caller.import({
      rows: [{ street1: 'Evergreen Terrace', city: 'Columbus', ...DISTRICT_COLUMNS }],
      file_name: 'addresses.csv',
    });

    expect(queuedRows()[0]).toMatchObject(DISTRICT_COLUMNS);
  });

  it('names exactly the fields the row reader looks for', () => {
    // `readImportedAreas` reads a row under the keys in IMPORTED_AREA_SETS. A key named here but
    // not there is never read; a key there but not here never gets past the request boundary.
    expect(Object.keys(ELECTORAL_IMPORT_ROW_FIELDS).sort()).toEqual(
      IMPORTED_AREA_SETS.map((spec) => spec.field).sort(),
    );
  });

  it('still refuses a column it does not name', async () => {
    // The dropping behaviour is deliberate everywhere else — this confirms the schema was widened
    // by exactly the seven electoral columns, not opened up to arbitrary keys.
    const caller = PersonsRouter.createCaller(ctx());

    await caller.import({ rows: [{ first_name: 'Ada', not_a_real_column: 'x' }], file_name: 'voterfile.csv' });

    expect(queuedRows()[0]).not.toHaveProperty('not_a_real_column');
  });
});
