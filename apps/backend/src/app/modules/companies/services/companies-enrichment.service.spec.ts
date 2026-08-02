import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../../env';
import { useTestTransaction } from '../../../lib/test-utils/db-test-isolation';
import {
  classifyPlacesHttpFailure,
  classifyPlacesStatus,
  CompaniesEnrichmentService,
  enrichmentIsSettled,
} from './companies-enrichment.service';

const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);

/**
 * The legacy Google Places endpoints answer HTTP 200 and report the real outcome in a `status`
 * field, so "the HTTP call succeeded" says nothing about whether the lookup did. Before this,
 * every non-OK status fell through to the same empty result and was stored as a successful
 * enrichment, which permanently marked the company done with no data in it.
 */
describe('Google Places status classification', () => {
  it('treats REQUEST_DENIED (a rejected or blocked API key) as a request that cannot succeed as sent', () => {
    const outcome = classifyPlacesStatus('Text Search', 'REQUEST_DENIED', 'The provided API key is invalid.');
    expect(outcome).toEqual({
      status: 'denied',
      detail: 'Text Search returned status REQUEST_DENIED: The provided API key is invalid.',
    });
  });

  it('treats INVALID_REQUEST as a request that cannot succeed as sent', () => {
    expect(classifyPlacesStatus('Text Search', 'INVALID_REQUEST', null)?.status).toBe('denied');
  });

  it('treats OVER_QUERY_LIMIT (quota exhausted) as worth retrying later, not as a result', () => {
    expect(classifyPlacesStatus('Text Search', 'OVER_QUERY_LIMIT', null)?.status).toBe('unavailable');
  });

  it('treats UNKNOWN_ERROR as worth retrying later', () => {
    expect(classifyPlacesStatus('Text Search', 'UNKNOWN_ERROR', null)?.status).toBe('unavailable');
  });

  it('treats an unrecognised status as retryable rather than guessing it is permanent', () => {
    expect(classifyPlacesStatus('Text Search', 'SOMETHING_NEW', null)?.status).toBe('unavailable');
  });

  it('treats ZERO_RESULTS as a real answer: Google looked and has no record', () => {
    expect(classifyPlacesStatus('Text Search', 'ZERO_RESULTS', null)).toEqual({ status: 'no_match' });
  });

  it('returns null for OK so the caller reads the body', () => {
    expect(classifyPlacesStatus('Text Search', 'OK', null)).toBeNull();
  });

  it('treats HTTP 429 and 5xx as retryable, and other 4xx as a rejected request', () => {
    expect(classifyPlacesHttpFailure('Details', 429).status).toBe('unavailable');
    expect(classifyPlacesHttpFailure('Details', 503).status).toBe('unavailable');
    expect(classifyPlacesHttpFailure('Details', 403).status).toBe('denied');
  });
});

describe('enrichmentIsSettled', () => {
  it('is false for a company with no enrichment recorded', () => {
    expect(enrichmentIsSettled(null)).toBe(false);
    expect(enrichmentIsSettled({})).toBe(false);
  });

  it('is true once Google has answered', () => {
    expect(enrichmentIsSettled({ google_enriched: true })).toBe(true);
  });

  it('is true for a company parked on a refused request, so nothing re-queues it', () => {
    expect(enrichmentIsSettled({ google_lookup: { status: 'denied', at: '2026-08-02T00:00:00.000Z' } })).toBe(true);
  });

  it('is false for a recorded lookup that is not a refusal', () => {
    expect(enrichmentIsSettled({ google_lookup: { status: 'no_match', at: '2026-08-02T00:00:00.000Z' } })).toBe(false);
  });
});

describe('lookupOutcome with no API key configured', () => {
  const originalKey = env.googleMapsApiKey;
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    env.googleMapsApiKey = originalKey;
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('reports that nothing is configured instead of inventing a website URL', async () => {
    // Leaving NODE_ENV=test would (correctly) keep the fabricated test fixture in play, so this
    // test steps outside test mode to exercise what a real deployment without a key does.
    process.env['NODE_ENV'] = 'production';
    env.googleMapsApiKey = '';

    const outcome = await CompaniesEnrichmentService.lookupOutcome('Acme Corp');

    expect(outcome).toEqual({ status: 'not_configured' });
  });

  it('gives the interactive add-form preview all-null fields rather than made-up ones', async () => {
    process.env['NODE_ENV'] = 'production';
    env.googleMapsApiKey = '';

    const result = await CompaniesEnrichmentService.lookupByName('Acme Corp');

    expect(result).toEqual({ website: null, phone: null, description: null, industry: null });
  });
});

describe('CompaniesEnrichmentService against the database', () => {
  const ctx = useTestTransaction();
  let tenantId: string;
  let userId: string;
  let companyId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    companyId = rand();

    await ctx.trx.insertInto('tenants').values({ id: tenantId, name: 'Enrichment Tenant' }).execute();
    await ctx.trx
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `enrich-${userId}@example.com`,
        password: 'password',
        first_name: 'Enrich',
        last_name: 'Tester',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await ctx.trx
      .insertInto('companies')
      .values({
        id: companyId,
        tenant_id: tenantId,
        name: 'Acme Corp',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  const readEnrichment = async (): Promise<Record<string, unknown> | null> => {
    const row = await ctx.trx
      .selectFrom('companies')
      .select(['enrichment', 'website'])
      .where('id', '=', companyId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!row || row.enrichment == null) return null;
    return typeof row.enrichment === 'string' ? JSON.parse(row.enrichment) : (row.enrichment as never);
  };

  const service = () => new CompaniesEnrichmentService(ctx.trx);

  it('records a refused request without claiming the company was enriched', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'lookupOutcome').mockResolvedValue({
      status: 'denied',
      detail: 'Text Search returned status REQUEST_DENIED',
    });

    await service().enrichCompany(companyId, tenantId);

    const enrichment = await readEnrichment();
    expect(enrichment?.['google_enriched']).toBeUndefined();
    expect(enrichment?.['google_lookup']).toMatchObject({ status: 'denied' });
  });

  it('leaves a company untouched and throws when the lookup is only temporarily unavailable', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'lookupOutcome').mockResolvedValue({
      status: 'unavailable',
      detail: 'Text Search returned status OVER_QUERY_LIMIT',
    });

    await expect(service().enrichCompany(companyId, tenantId)).rejects.toThrow(/unavailable/i);

    // Nothing recorded, so the row still looks un-enriched and the daily sweep will retry it.
    expect(await readEnrichment()).toBeNull();
  });

  it('writes nothing at all when no API key is configured', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'lookupOutcome').mockResolvedValue({ status: 'not_configured' });

    await service().enrichCompany(companyId, tenantId);

    expect(await readEnrichment()).toBeNull();
  });

  it('marks a company enriched when Google answers that it has no record of it', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'lookupOutcome').mockResolvedValue({ status: 'no_match' });

    await service().enrichCompany(companyId, tenantId);

    const enrichment = await readEnrichment();
    expect(enrichment?.['google_enriched']).toBe(true);
    expect(enrichment?.['google_lookup']).toMatchObject({ status: 'no_match' });
  });

  it('stores the fields and marks the company enriched on a successful lookup', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'lookupOutcome').mockResolvedValue({
      status: 'ok',
      result: {
        website: 'https://acme.example',
        phone: '+1 555-0100',
        description: 'A real description',
        industry: 'Manufacturing',
      },
    });

    await service().enrichCompany(companyId, tenantId);

    const enrichment = await readEnrichment();
    expect(enrichment?.['google_enriched']).toBe(true);
    expect(enrichment?.['google_lookup']).toMatchObject({ status: 'ok' });

    const row = await ctx.trx
      .selectFrom('companies')
      .select('website')
      .where('id', '=', companyId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    expect(row?.website).toBe('https://acme.example');
  });

  it('re-runs a refused lookup when the user presses Re-check Google', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'lookupOutcome').mockResolvedValue({ status: 'no_match' });
    await ctx.trx
      .updateTable('companies')
      .set({ enrichment: JSON.stringify({ google_lookup: { status: 'denied', at: '2026-08-01T00:00:00.000Z' } }) })
      .where('id', '=', companyId)
      .where('tenant_id', '=', tenantId)
      .execute();

    await service().enrichCompany(companyId, tenantId, true);

    expect((await readEnrichment())?.['google_enriched']).toBe(true);
  });

  describe('hasPendingEnrichmentJob', () => {
    const queueJob = async (status: string, forCompanyId: string) => {
      await ctx.trx
        .insertInto('background_jobs')
        .values({
          tenant_id: tenantId,
          queue: 'default',
          status,
          payload: JSON.stringify({
            type: 'enrich_company_google',
            company_id: forCompanyId,
            tenant_id: tenantId,
          }),
          run_at: new Date(),
          max_attempts: 3,
        })
        .execute();
    };

    it('sees a job that is still waiting to run', async () => {
      await queueJob('pending', companyId);
      expect(await CompaniesEnrichmentService.hasPendingEnrichmentJob(ctx.trx, tenantId, companyId)).toBe(true);
    });

    it('sees a job that is running right now', async () => {
      await queueJob('processing', companyId);
      expect(await CompaniesEnrichmentService.hasPendingEnrichmentJob(ctx.trx, tenantId, companyId)).toBe(true);
    });

    it('ignores a finished job, so a later re-check can still be queued', async () => {
      await queueJob('completed', companyId);
      expect(await CompaniesEnrichmentService.hasPendingEnrichmentJob(ctx.trx, tenantId, companyId)).toBe(false);
    });

    it('ignores a pending job belonging to a different company', async () => {
      await queueJob('pending', rand());
      expect(await CompaniesEnrichmentService.hasPendingEnrichmentJob(ctx.trx, tenantId, companyId)).toBe(false);
    });

    it('is scoped to the tenant', async () => {
      await queueJob('pending', companyId);
      const otherTenant = rand();
      await ctx.trx.insertInto('tenants').values({ id: otherTenant, name: 'Other' }).execute();
      expect(await CompaniesEnrichmentService.hasPendingEnrichmentJob(ctx.trx, otherTenant, companyId)).toBe(false);
    });
  });

  describe('queueUnenrichedCompanies', () => {
    const countQueued = async (): Promise<number> => {
      const rows = await ctx.trx.selectFrom('background_jobs').select('id').where('tenant_id', '=', tenantId).execute();
      return rows.length;
    };

    it('does not re-queue a company parked on a refused request', async () => {
      await ctx.trx
        .updateTable('companies')
        .set({ enrichment: JSON.stringify({ google_lookup: { status: 'denied', at: '2026-08-01T00:00:00.000Z' } }) })
        .where('id', '=', companyId)
        .where('tenant_id', '=', tenantId)
        .execute();

      expect(await service().queueUnenrichedCompanies(tenantId)).toBe(0);
      expect(await countQueued()).toBe(0);
    });

    it('queues a company that has never been looked up', async () => {
      expect(await service().queueUnenrichedCompanies(tenantId)).toBe(1);
      expect(await countQueued()).toBe(1);
    });
  });
});
