import { signal } from '@angular/core';
import { vi } from 'vitest';
import { CompaniesService } from './companies-service';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let mockApi: any;

  const mockCompany = {
    id: '1',
    name: 'Acme Corp',
    website: 'https://acme.example.com',
    industry: 'Technology',
    email: 'info@acme.example.com',
    phone: '555-0100',
    description: 'Widgets and gadgets',
  };

  beforeEach(() => {
    mockApi = {
      companies: {
        add: { mutate: vi.fn() },
        update: { mutate: vi.fn() },
        getAll: { query: vi.fn() },
        getById: { query: vi.fn() },
        count: { query: vi.fn() },
        delete: { mutate: vi.fn() },
        import: { mutate: vi.fn() },
        exportCsv: { mutate: vi.fn() },
        getPotentialDuplicates: { query: vi.fn() },
        mergeCompanies: { mutate: vi.fn() },
      },
      exports: {
        queue: { mutate: vi.fn() },
      },
    };

    // Create a bare instance without invoking Angular inject()s, matching the
    // house pattern used for other TRPCService-backed services.
    service = Object.create(CompaniesService.prototype) as CompaniesService;
    (service as any).api = mockApi;
    (service as any).ac = new AbortController();
    (service as any).refreshCount = signal(0);
    (service as any).endpointName = 'companies';
  });

  describe('Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });
  });

  describe('CRUD operations', () => {
    it('should add a company', async () => {
      mockApi.companies.add.mutate.mockResolvedValue(mockCompany);

      const result = await service.add({ name: 'Acme Corp' } as any);

      expect(mockApi.companies.add.mutate).toHaveBeenCalledWith({ name: 'Acme Corp' });
      expect(result).toEqual(mockCompany);
    });

    it('should resolve addMany with the given rows without calling the API', async () => {
      const rows = [{ name: 'Acme Corp' }, { name: 'Beta LLC' }] as any[];

      const result = await service.addMany(rows);

      expect(result).toEqual(rows);
    });

    it('should get a company by id', async () => {
      mockApi.companies.getById.query.mockResolvedValue(mockCompany);

      const result = await service.getById('1');

      expect(mockApi.companies.getById.query).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockCompany);
    });

    it('should get all companies scoped by the abort signal', async () => {
      const mockResult = { rows: [mockCompany], count: 1 };
      mockApi.companies.getAll.query.mockResolvedValue(mockResult);

      const result = await service.getAll({ startRow: 0, endRow: 25 } as any);

      expect(mockApi.companies.getAll.query).toHaveBeenCalledWith(
        { startRow: 0, endRow: 25 },
        { signal: (service as any).ac.signal },
      );
      expect(result).toEqual(mockResult);
    });

    it('should update a company', async () => {
      const updated = { ...mockCompany, name: 'Acme Corp International' };
      mockApi.companies.update.mutate.mockResolvedValue(updated);

      const result = await service.update('1', { name: 'Acme Corp International' } as any);

      expect(mockApi.companies.update.mutate).toHaveBeenCalledWith({
        id: '1',
        data: { name: 'Acme Corp International' },
      });
      expect(result).toEqual(updated);
    });

    it('should delete a company via the inherited AbstractAPIService.delete', async () => {
      mockApi.companies.delete.mutate.mockResolvedValue(true);

      const result = await service.delete('1');

      expect(mockApi.companies.delete.mutate).toHaveBeenCalledWith('1');
      expect(result).toBe(true);
    });

    it('should delete many companies one at a time when no deleteMany endpoint exists', async () => {
      mockApi.companies.delete.mutate.mockResolvedValue(true);

      const result = await service.deleteMany(['1', '2']);

      expect(mockApi.companies.delete.mutate).toHaveBeenCalledWith('1');
      expect(mockApi.companies.delete.mutate).toHaveBeenCalledWith('2');
      expect(mockApi.companies.delete.mutate).toHaveBeenCalledTimes(2);
      expect(result).toBe(true);
    });
  });

  describe('Import & export', () => {
    it('should pass the upload handle, mapping and file name through to the import mutation', async () => {
      const mockResponse = { import_id: 'imp-1', skipped: 0, file_name: 'companies.csv', status: 'pending' };
      mockApi.companies.import.mutate.mockResolvedValue(mockResponse);

      const result = await service.import({
        upload_handle: 'handle-1',
        mapping: { '0': 'name' },
        file_name: 'companies.csv',
      });

      expect(mockApi.companies.import.mutate).toHaveBeenCalledWith({
        upload_handle: 'handle-1',
        mapping: { '0': 'name' },
        file_name: 'companies.csv',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should export companies to CSV', async () => {
      const mockResponse = { url: 'https://example.com/export.csv' };
      mockApi.companies.exportCsv.mutate.mockResolvedValue(mockResponse);

      const result = await service.exportCsv({ scope: 'all' } as any);

      expect(mockApi.companies.exportCsv.mutate).toHaveBeenCalledWith({ scope: 'all' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Duplicates & merging', () => {
    it('should fetch potential duplicates', async () => {
      const mockDuplicates = { groups: [] };
      mockApi.companies.getPotentialDuplicates.query.mockResolvedValue(mockDuplicates);

      const result = await service.getPotentialDuplicates({ threshold: 0.8 } as any);

      expect(mockApi.companies.getPotentialDuplicates.query).toHaveBeenCalledWith({ threshold: 0.8 });
      expect(result).toEqual(mockDuplicates);
    });

    it('should merge two companies by target and source id', async () => {
      const mockMergeResult = { merged: true };
      mockApi.companies.mergeCompanies.mutate.mockResolvedValue(mockMergeResult);

      const result = await service.mergeCompanies('target-1', 'source-1');

      expect(mockApi.companies.mergeCompanies.mutate).toHaveBeenCalledWith({
        target_id: 'target-1',
        source_id: 'source-1',
      });
      expect(result).toEqual(mockMergeResult);
    });
  });

  describe('Placeholder endpoints', () => {
    it('should query the tenant-scoped company count', async () => {
      mockApi.companies.count.query.mockResolvedValue(214);

      await expect(service.count()).resolves.toBe(214);
      expect(mockApi.companies.count.query).toHaveBeenCalled();
    });

    it('should resolve getTags with an empty array', async () => {
      await expect(service.getTags('1')).resolves.toEqual([]);
    });

    it('should resolve getAllArchived with an empty result set', async () => {
      await expect(service.getAllArchived()).resolves.toEqual({ rows: [], count: 0 });
    });

    it('should resolve attachTag without error', async () => {
      await expect(service.attachTag('1', 'donor')).resolves.toBeUndefined();
    });

    it('should resolve detachTag with true', async () => {
      await expect(service.detachTag('1', 'donor')).resolves.toBe(true);
    });
  });

  describe('Shared refresh signal', () => {
    it('should increment refreshCount when triggerRefresh is called', () => {
      expect(service.refreshCount()).toBe(0);

      service.triggerRefresh();

      expect(service.refreshCount()).toBe(1);
    });
  });

  describe('Error handling', () => {
    it('should propagate errors from getAll', async () => {
      mockApi.companies.getAll.query.mockRejectedValue(new Error('Network error'));

      await expect(service.getAll()).rejects.toThrow('Network error');
    });
  });
});
