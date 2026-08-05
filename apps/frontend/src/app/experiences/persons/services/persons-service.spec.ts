import { vi } from 'vitest';
import { COMPANION_MERGE_CHECK_FAILED, PersonsService, companionAccessMergeWarning } from './persons-service';

describe('PersonsService', () => {
  let service: PersonsService;
  let mockApi: any;

  beforeEach(() => {
    mockApi = {
      persons: {
        add: { mutate: vi.fn() },
        attachTag: { mutate: vi.fn() },
        count: { query: vi.fn() },
        delete: { mutate: vi.fn() },
        deleteMany: { mutate: vi.fn() },
        moveEntireHousehold: { mutate: vi.fn() },
        detachTag: { mutate: vi.fn() },
        getAllWithAddress: { query: vi.fn() },
        getByHouseholdId: { query: vi.fn() },
        getByCompanyId: { query: vi.fn() },
        countByCompanyId: { query: vi.fn() },
        getById: { query: vi.fn() },
        getActivity: { query: vi.fn() },
        getTags: { query: vi.fn() },
        import: { mutate: vi.fn() },
        removeHousehold: { mutate: vi.fn() },
        update: { mutate: vi.fn() },
        exportCsv: { mutate: vi.fn() },
        getPotentialDuplicates: { query: vi.fn() },
        getDuplicateCounts: { query: vi.fn() },
        mergePersons: { mutate: vi.fn() },
        mergeImpact: { query: vi.fn() },
        checkDuplicateEmails: { query: vi.fn() },
      },
    };

    // Create a bare instance without invoking Angular inject()s
    service = Object.create(PersonsService.prototype) as PersonsService;
    (service as any).api = mockApi;
    (service as any).ac = new AbortController();
    (service as any).endpointName = 'persons';
  });

  describe('delete', () => {
    it('sends force and skip-alert options when both are requested', async () => {
      mockApi.persons.delete.mutate.mockResolvedValue({ id: '1' });

      const result = await service.delete('1', true, true);

      expect(mockApi.persons.delete.mutate).toHaveBeenCalledWith(
        { id: '1', force: true },
        { context: { skipErrorHandler: true } },
      );
      expect(result).toBe(true);
    });

    it('sends only the id when force is not specified', async () => {
      mockApi.persons.delete.mutate.mockResolvedValue({ id: '1' });

      await service.delete('1');

      expect(mockApi.persons.delete.mutate).toHaveBeenCalledWith('1', undefined);
    });

    it('resolves false when the api returns null', async () => {
      mockApi.persons.delete.mutate.mockResolvedValue(null);

      const result = await service.delete('1');

      expect(result).toBe(false);
    });
  });

  describe('deleteMany', () => {
    it('forwards force and skip-alert flags', async () => {
      mockApi.persons.deleteMany.mutate.mockResolvedValue(true);

      const result = await service.deleteMany(['1', '2'], false, true);

      expect(mockApi.persons.deleteMany.mutate).toHaveBeenCalledWith(
        { ids: ['1', '2'], force: false },
        { context: { skipErrorHandler: true } },
      );
      expect(result).toBe(true);
    });
  });

  describe('getPeopleInHousehold', () => {
    it('returns an empty array when no household id is given', async () => {
      const result = await service.getPeopleInHousehold(null);

      expect(result).toEqual([]);
      expect(mockApi.persons.getByHouseholdId.query).not.toHaveBeenCalled();
    });

    it('merges name columns into the request and builds a full_name', async () => {
      mockApi.persons.getByHouseholdId.query.mockResolvedValue([
        { id: '1', first_name: 'Jane', middle_names: '', last_name: 'Doe' },
      ]);

      const result = await service.getPeopleInHousehold('h1', { columns: ['id'] });

      expect(mockApi.persons.getByHouseholdId.query).toHaveBeenCalledWith({
        id: 'h1',
        options: { columns: ['id', 'first_name', 'middle_names', 'last_name'] },
      });
      expect(result).toEqual([
        { id: '1', first_name: 'Jane', middle_names: '', last_name: 'Doe', full_name: 'Jane  Doe' },
      ]);
    });
  });

  describe('getTags', () => {
    it('maps the tag objects returned by the api down to their names', async () => {
      mockApi.persons.getTags.query.mockResolvedValue([{ name: 'donor' }, { name: 'vip' }]);

      const result = await service.getTags('1', 'tag');

      expect(mockApi.persons.getTags.query).toHaveBeenCalledWith({ id: '1', type: 'tag' });
      expect(result).toEqual(['donor', 'vip']);
    });
  });

  describe('getAllArchived', () => {
    it('always resolves with an empty result (archives unsupported)', async () => {
      const result = await service.getAllArchived();

      expect(result).toEqual({ rows: [], count: 0 });
    });
  });

  describe('mergePersons', () => {
    it('delegates to the api mergePersons mutation', async () => {
      const response = { merged: true };
      mockApi.persons.mergePersons.mutate.mockResolvedValue(response);

      const result = await service.mergePersons('target-1', 'source-1');

      expect(mockApi.persons.mergePersons.mutate).toHaveBeenCalledWith({
        target_id: 'target-1',
        source_id: 'source-1',
      });
      expect(result).toEqual(response);
    });
  });

  describe('import', () => {
    it('forwards the upload handle, mapping, tags and fileName, defaulting the duplicate decision to skip', async () => {
      const response = { imported: 2, skipped: 0 };
      mockApi.persons.import.mutate.mockResolvedValue(response);

      const result = await service.import({
        upload_handle: 'handle-1',
        mapping: { '0': 'first_name' },
        tags: ['tag1'],
        file_name: 'people.csv',
      });

      expect(mockApi.persons.import.mutate).toHaveBeenCalledWith(
        {
          upload_handle: 'handle-1',
          mapping: { '0': 'first_name' },
          tags: ['tag1'],
          file_name: 'people.csv',
          duplicate_decision: 'skip',
          list_name: undefined,
        },
        undefined,
      );
      expect(result).toEqual(response);
    });

    it('opts out of the global error handler when asked', async () => {
      mockApi.persons.import.mutate.mockResolvedValue({ imported: 0, skipped: 0 });

      await service.import({ upload_handle: 'handle-1', mapping: {} }, { skipErrorHandler: true });

      expect(mockApi.persons.import.mutate).toHaveBeenCalledWith(expect.anything(), {
        context: { skipErrorHandler: true },
      });
    });
  });

  describe('checkDuplicateEmails', () => {
    it('queries the email-identity duplicate check', async () => {
      const response = [{ email: 'a@example.com', person_id: '1', name: 'A', slug: 'a' }];
      mockApi.persons.checkDuplicateEmails.query.mockResolvedValue(response);

      const result = await service.checkDuplicateEmails(['a@example.com']);

      expect(mockApi.persons.checkDuplicateEmails.query).toHaveBeenCalledWith({ emails: ['a@example.com'] });
      expect(result).toEqual(response);
    });
  });

  describe('campaign scoping (§15)', () => {
    it('stamps the active campaign into getAllWithAddress reads', async () => {
      (service as any).campaignContext = { activeCampaignId: () => 'camp-1' };
      mockApi.persons.getAllWithAddress.query.mockResolvedValue({ rows: [], count: 0 });

      await service.getAllWithAddress({ startRow: 0, endRow: 25 } as any);

      expect(mockApi.persons.getAllWithAddress.query).toHaveBeenCalledWith(
        { startRow: 0, endRow: 25, campaignId: 'camp-1' },
        { signal: (service as any).ac.signal },
      );
    });

    it('leaves reads unscoped when no campaign is active', async () => {
      (service as any).campaignContext = { activeCampaignId: () => null };
      mockApi.persons.getAllWithAddress.query.mockResolvedValue({ rows: [], count: 0 });

      await service.getAllWithAddress({ startRow: 0, endRow: 25 } as any);

      expect(mockApi.persons.getAllWithAddress.query).toHaveBeenCalledWith(
        { startRow: 0, endRow: 25 },
        { signal: (service as any).ac.signal },
      );
    });
  });
  // Merging two people who both hold a companion volunteer record keeps only one of them, which
  // can take a working volunteer's access to the canvassing and delivery apps away. The dialog
  // must say so, and only on the pairs where it is true.
  describe('companionAccessMergeWarning', () => {
    const names = { target: 'Rosa Diaz', source: 'Rosa D' };
    const impact = (target: unknown, source: unknown) =>
      ({ companionAccess: { target, source } }) as Parameters<typeof companionAccessMergeWarning>[0];

    it('says nothing when neither person is a companion volunteer', () => {
      expect(companionAccessMergeWarning(impact(null, null), names)).toBeNull();
    });

    it('says nothing when only one of them is a volunteer, because that row simply moves', () => {
      expect(companionAccessMergeWarning(impact(null, 'approved'), names)).toBeNull();
      expect(companionAccessMergeWarning(impact('approved', null), names)).toBeNull();
    });

    it('says the merge takes access away when the record being removed is the approved one', () => {
      const warning = companionAccessMergeWarning(impact('invited', 'approved'), names);

      expect(warning).toContain("takes away Rosa D's companion access");
      expect(warning).toContain('Rosa Diaz is invited but has never verified a code');
      expect(warning).toContain('verifies a code again');
    });

    it('warns about signed-out devices when both records are approved', () => {
      const warning = companionAccessMergeWarning(impact('approved', 'approved'), names);

      expect(warning).toContain('both approved companion volunteers');
      expect(warning).toContain("signs out Rosa D's devices");
    });

    it('warns that a pending verification is discarded', () => {
      const warning = companionAccessMergeWarning(impact('invited', 'verified'), names);

      expect(warning).toContain("discards Rosa D's companion verification");
    });

    it('stays quiet when the removed record was only an unused invitation or already revoked', () => {
      expect(companionAccessMergeWarning(impact('approved', 'invited'), names)).toBeNull();
      expect(companionAccessMergeWarning(impact('approved', 'revoked'), names)).toBeNull();
    });

    it('stays quiet when the surviving record is already approved and the other was only pending', () => {
      expect(companionAccessMergeWarning(impact('approved', 'verified'), names)).toBeNull();
    });
  });

  describe('mergeWarning', () => {
    const names = { target: 'Rosa Diaz', source: 'Rosa D' };

    it('asks the impact endpoint for this pair and suppresses the global error toast', async () => {
      mockApi.persons.mergeImpact.query.mockResolvedValue({
        companionAccess: { target: 'invited', source: 'approved' },
      });

      const warning = await service.mergeWarning('p1', 'p2', names);

      expect(mockApi.persons.mergeImpact.query).toHaveBeenCalledWith(
        { target_id: 'p1', source_id: 'p2' },
        { context: { skipErrorHandler: true } },
      );
      expect(warning).toContain("takes away Rosa D's companion access");
    });

    it('admits it could not check rather than implying there is nothing to lose', async () => {
      mockApi.persons.mergeImpact.query.mockRejectedValue(new Error('offline'));

      expect(await service.mergeWarning('p1', 'p2', names)).toBe(COMPANION_MERGE_CHECK_FAILED);
    });
  });
});
