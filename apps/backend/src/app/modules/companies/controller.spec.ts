import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompaniesController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { CompaniesEnrichmentService } from './services/companies-enrichment.service';

describe('CompaniesController', () => {
  let controller: CompaniesController;

  beforeEach(() => {
    controller = new CompaniesController();
    vi.restoreAllMocks();
  });

  it('should call addCompany and add record to repository', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const payload = {
      name: 'Acme Corp',
      description: 'An Acme company',
      website: 'acme.corp',
      email: 'info@acme.corp',
      phone: '123-456-7890',
      industry: 'Manufacturing',
      notes: 'Some notes',
    };

    const mockCompany = { id: '123', ...payload, tenant_id: 'tenant-1' };
    const spy = vi.spyOn(controller, 'add').mockResolvedValue(mockCompany as any);

    const result = await controller.addCompany(payload, auth);

    expect(spy).toHaveBeenCalledWith({
      name: 'Acme Corp',
      description: 'An Acme company',
      website: 'acme.corp',
      email: 'info@acme.corp',
      phone: '123-456-7890',
      industry: 'Manufacturing',
      notes: 'Some notes',
      tenant_id: 'tenant-1',
      createdby_id: 'user-1',
      updatedby_id: 'user-1',
    });
    expect(result).toEqual(mockCompany);
  });

  it('should call updateCompany and update record in repository', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const updatePayload = {
      name: 'Acme Corp Updated',
    };

    const mockUpdatedCompany = { id: '123', name: 'Acme Corp Updated', tenant_id: 'tenant-1' };
    const spy = vi.spyOn(controller, 'update').mockResolvedValue(mockUpdatedCompany as any);

    const result = await controller.updateCompany('123', updatePayload, auth);

    expect(spy).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      id: '123',
      row: {
        name: 'Acme Corp Updated',
        updatedby_id: 'user-1',
      },
    });
    expect(result).toEqual(mockUpdatedCompany);
  });

  it('should call getAllCompanies and list records from repository', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const mockCompanies = [{ id: '123', name: 'Acme Corp' }];
    const spy = vi
      .spyOn(controller, 'getAllWithCounts')
      .mockResolvedValue({ rows: mockCompanies, count: mockCompanies.length } as any);

    const result = await controller.getAllCompanies(auth, { limit: 10 });

    expect(spy).toHaveBeenCalledWith('tenant-1', { limit: 10 });
    expect(result).toEqual({ rows: mockCompanies, count: mockCompanies.length });
  });
});

/**
 * Opening a company's detail page auto-queues a Google Places lookup. Each lookup is two
 * billable Google calls, and the page-view path had no check for a job that was already
 * queued — so every view between the first one and the first job finishing queued another job
 * for the same company.
 */
describe('CompaniesController.getOneById enrichment queueing', () => {
  let controller: CompaniesController;
  let insertInto: ReturnType<typeof vi.fn>;
  let queuedValues: unknown;

  const mockDb = () => {
    queuedValues = undefined;
    insertInto = vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        queuedValues = v;
        return { execute: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    return { insertInto };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    controller = new CompaniesController();
    vi.spyOn(BaseRepository.prototype, 'db', 'get').mockReturnValue(mockDb() as never);
  });

  const viewCompany = async (enrichment: unknown) => {
    vi.spyOn(BaseRepository.prototype, 'getOneById').mockResolvedValue({ id: '55', enrichment } as never);
    return controller.getOneById({ tenant_id: 'tenant-1', id: '55' });
  };

  it('queues one lookup when the company has never been looked up and nothing is in flight', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'hasPendingEnrichmentJob').mockResolvedValue(false);

    await viewCompany(null);

    expect(insertInto).toHaveBeenCalledTimes(1);
    expect(insertInto).toHaveBeenCalledWith('background_jobs');
    expect(JSON.parse(String((queuedValues as { payload: string }).payload))).toMatchObject({
      type: 'enrich_company_google',
      company_id: '55',
    });
  });

  it('queues nothing when a lookup for this company is already pending or running', async () => {
    const pending = vi.spyOn(CompaniesEnrichmentService, 'hasPendingEnrichmentJob').mockResolvedValue(true);

    await viewCompany(null);

    expect(pending).toHaveBeenCalledWith(expect.anything(), 'tenant-1', '55');
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('queues nothing for a company Google has already answered about', async () => {
    const pending = vi.spyOn(CompaniesEnrichmentService, 'hasPendingEnrichmentJob').mockResolvedValue(false);

    await viewCompany({ google_enriched: true });

    expect(pending).not.toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('queues nothing for a company parked on a request Google refused', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'hasPendingEnrichmentJob').mockResolvedValue(false);

    await viewCompany({ google_lookup: { status: 'denied', at: '2026-08-01T00:00:00.000Z' } });

    expect(insertInto).not.toHaveBeenCalled();
  });

  it('still returns the company when the enrichment column holds unparseable JSON', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'hasPendingEnrichmentJob').mockResolvedValue(false);

    const company = await viewCompany('{not json');

    expect(company).toMatchObject({ id: '55' });
    expect(insertInto).toHaveBeenCalledTimes(1);
  });

  it('still returns the company when queueing the lookup fails', async () => {
    vi.spyOn(CompaniesEnrichmentService, 'hasPendingEnrichmentJob').mockRejectedValue(new Error('db down'));

    const company = await viewCompany(null);

    expect(company).toMatchObject({ id: '55' });
    expect(insertInto).not.toHaveBeenCalled();
  });
});
