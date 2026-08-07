import { vi } from 'vitest';
import { DonationsService } from './donations-service';

describe('DonationsService', () => {
  let service: DonationsService;
  let mockApi: any;
  let notify: any;

  beforeEach(() => {
    mockApi = {
      donations: {
        getAll: { query: vi.fn() },
        getLedgerSummary: { query: vi.fn() },
        getPersonDonationHistory: { query: vi.fn() },
        getDonationStats: { query: vi.fn() },
        checkEligibility: { query: vi.fn() },
        createCheckout: { mutate: vi.fn() },
        recordDonation: { mutate: vi.fn() },
        confirmDonation: { mutate: vi.fn() },
        confirmMockDonation: { mutate: vi.fn() },
        createRecurringCheckout: { mutate: vi.fn() },
        confirmMockPledge: { mutate: vi.fn() },
        listPledges: { query: vi.fn() },
        getPersonPledges: { query: vi.fn() },
        cancelPledge: { mutate: vi.fn() },
        getDonationPeriods: { query: vi.fn() },
        createDonationPeriod: { mutate: vi.fn() },
        updateDonationPeriod: { mutate: vi.fn() },
        deleteDonationPeriod: { mutate: vi.fn() },
      },
    };

    notify = vi.fn();
    service = Object.create(DonationsService.prototype) as DonationsService;
    (service as any).api = mockApi;
    // Object.create skips field initializers — restore the three the service relies on: the abort
    // controller and list scope the grid contract needs, and the changed-tick every write raises.
    (service as any).ac = new AbortController();
    (service as any).changed = { notify };
    service.listScope = 'all';
  });

  it('should stamp its fixed scope onto every grid page request', async () => {
    mockApi.donations.getAll.query.mockResolvedValue({ rows: [], count: 0 });

    await service.getAll({ startRow: 0, endRow: 25 });

    const [options] = mockApi.donations.getAll.query.mock.calls[0];
    expect(options.startRow).toBe(0);
    expect(options.endRow).toBe(25);
    expect(options.filterModel).toEqual({ donation_scope: { value: 'all' } });
  });

  it('should send the one-time scope without clobbering other column filters', async () => {
    mockApi.donations.getAll.query.mockResolvedValue({ rows: [], count: 0 });
    service.listScope = 'one-time';

    await service.getAll({ filterModel: { method: { op: 'contains', value: 'cash' } } });

    const [options] = mockApi.donations.getAll.query.mock.calls[0];
    expect(options.filterModel).toEqual({
      method: { op: 'contains', value: 'cash' },
      donation_scope: { value: 'one-time' },
    });
  });

  it('should fetch the ledger summary for a scope', async () => {
    const summary = { totalCents: 5000, totalCount: 1 };
    mockApi.donations.getLedgerSummary.query.mockResolvedValue(summary);

    const result = await service.getLedgerSummary('one-time');

    expect(mockApi.donations.getLedgerSummary.query).toHaveBeenCalledWith(
      { scope: 'one-time' },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(result).toEqual(summary);
  });

  it('should fetch a person donation history', async () => {
    const history = [{ id: '1' }];
    mockApi.donations.getPersonDonationHistory.query.mockResolvedValue(history);

    const result = await service.getHistory('person-1');

    expect(mockApi.donations.getPersonDonationHistory.query).toHaveBeenCalledWith('person-1');
    expect(result).toEqual(history);
  });

  it('should fetch donation stats for a person', async () => {
    const stats = { total: 100 };
    mockApi.donations.getDonationStats.query.mockResolvedValue(stats);

    const result = await service.getStats('person-1');

    expect(mockApi.donations.getDonationStats.query).toHaveBeenCalledWith('person-1');
    expect(result).toEqual(stats);
  });

  it('should check eligibility with the full payload', async () => {
    const payload = {
      personId: 'p1',
      amountCents: 2500,
      address: { country: 'CA', state: 'ON' },
      isRecurring: false,
    };
    mockApi.donations.checkEligibility.query.mockResolvedValue({ eligible: true });

    const result = await service.checkEligibility(payload);

    expect(mockApi.donations.checkEligibility.query).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ eligible: true });
  });

  it('should create a one-time checkout session', async () => {
    const payload = { personId: 'p1', amountCents: 1000, address: { country: 'US' } };
    mockApi.donations.createCheckout.mutate.mockResolvedValue({ url: 'https://checkout' });

    const result = await service.createCheckout(payload);

    expect(mockApi.donations.createCheckout.mutate).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ url: 'https://checkout' });
  });

  it('should confirm a donation by session id', async () => {
    mockApi.donations.confirmDonation.mutate.mockResolvedValue({ id: 'd1' });

    const result = await service.confirmDonation('sess_123');

    expect(mockApi.donations.confirmDonation.mutate).toHaveBeenCalledWith({ sessionId: 'sess_123' });
    expect(result).toEqual({ id: 'd1' });
  });

  it('should create a recurring checkout session', async () => {
    const payload = { personId: 'p1', monthlyAmountCents: 2000, address: { country: 'US' } };
    mockApi.donations.createRecurringCheckout.mutate.mockResolvedValue({ url: 'https://checkout/recurring' });

    const result = await service.createRecurringCheckout(payload);

    expect(mockApi.donations.createRecurringCheckout.mutate).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ url: 'https://checkout/recurring' });
  });

  it('should list recurring pledges', async () => {
    const rows = [{ id: 'pl1', status: 'active' }];
    mockApi.donations.listPledges.query.mockResolvedValue(rows);

    const result = await service.listPledges();

    expect(mockApi.donations.listPledges.query).toHaveBeenCalledWith();
    expect(result).toEqual(rows);
  });

  it('should cancel a pledge by id', async () => {
    mockApi.donations.cancelPledge.mutate.mockResolvedValue({ success: true });

    const result = await service.cancelPledge('pl1');

    expect(mockApi.donations.cancelPledge.mutate).toHaveBeenCalledWith({ pledgeId: 'pl1' });
    expect(result).toEqual({ success: true });
  });

  it('should fetch donation periods', async () => {
    const periods = [{ id: 'period-1', name: '2026' }];
    mockApi.donations.getDonationPeriods.query.mockResolvedValue(periods);

    const result = await service.getDonationPeriods();

    expect(mockApi.donations.getDonationPeriods.query).toHaveBeenCalled();
    expect(result).toEqual(periods);
  });

  it('should create a donation period', async () => {
    const payload = { name: '2026 Campaign', start_date: '2026-01-01', limit_amount: 100000 };
    mockApi.donations.createDonationPeriod.mutate.mockResolvedValue({ id: 'period-2' });

    const result = await service.createDonationPeriod(payload);

    expect(mockApi.donations.createDonationPeriod.mutate).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ id: 'period-2' });
  });

  it('should update a donation period', async () => {
    const payload = { id: 'period-2', is_active: false };
    mockApi.donations.updateDonationPeriod.mutate.mockResolvedValue({ id: 'period-2', is_active: false });

    const result = await service.updateDonationPeriod(payload);

    expect(mockApi.donations.updateDonationPeriod.mutate).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ id: 'period-2', is_active: false });
  });

  it('should delete a donation period', async () => {
    mockApi.donations.deleteDonationPeriod.mutate.mockResolvedValue(undefined);

    await service.deleteDonationPeriod('period-2');

    expect(mockApi.donations.deleteDonationPeriod.mutate).toHaveBeenCalledWith({ id: 'period-2' });
  });

  it('announces every gift it records, so grids it does not own reload too', async () => {
    mockApi.donations.recordDonation.mutate.mockResolvedValue({ id: 'gift-1' });

    const result = await service.recordDonation({
      personId: 'p1',
      amountCents: 5000,
      method: 'cash',
      address: { street: '1 Main St', apt: null, city: 'Toronto', state: 'ON', zip: 'M1M1M1', country: 'Canada' },
    });

    expect(result).toEqual({ id: 'gift-1' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the write fails, so nothing reloads for a gift that was not saved', async () => {
    mockApi.donations.recordDonation.mutate.mockRejectedValue(new Error('nope'));

    await expect(
      service.recordDonation({
        personId: 'p1',
        amountCents: 5000,
        method: 'cash',
        address: { street: '1 Main St', apt: null, city: 'Toronto', state: 'ON', zip: 'M1M1M1', country: 'Canada' },
      }),
    ).rejects.toThrow('nope');
    expect(notify).not.toHaveBeenCalled();
  });

  it('should propagate errors from the tRPC client', async () => {
    const error = new Error('Network failure');
    mockApi.donations.getAll.query.mockRejectedValue(error);

    await expect(service.getAll()).rejects.toThrow('Network failure');
  });
});
