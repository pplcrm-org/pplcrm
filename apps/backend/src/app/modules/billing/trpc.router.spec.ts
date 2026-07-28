import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BillingRouter } from './trpc.router';
import { BillingController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

function mockAuthDb(role: string) {
  const mockQB: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ role, verified: true }),
  };
  vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
    selectFrom: vi.fn().mockReturnValue(mockQB),
  } as any);
}

describe('BillingRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb('owner');
  });

  it('should call getBillingDetails on the controller', async () => {
    const mockDetails = { plan: 'free', status: 'inactive' };
    const spy = vi.spyOn(BillingController.prototype, 'getBillingDetails').mockResolvedValue(mockDetails as any);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getDetails();

    expect(spy).toHaveBeenCalledWith({
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toEqual(mockDetails);
  });

  it('should call getUsage on the controller', async () => {
    const mockUsage = {
      subscribers: 1234,
      billedQuantity: 1,
      subscriberCap: 2500,
      emailCap: 30000,
      monthlyPrice: 29,
      interval: 'month' as const,
      tierMax: 11,
    };
    const spy = vi.spyOn(BillingController.prototype, 'getUsage').mockResolvedValue(mockUsage);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getUsage();

    expect(spy).toHaveBeenCalledWith({
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toEqual(mockUsage);
  });

  it('should call createCheckoutSession with the requested plan', async () => {
    const spy = vi
      .spyOn(BillingController.prototype, 'createCheckoutSession')
      .mockResolvedValue({ url: 'https://checkout.example.com' } as any);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.createCheckout({ plan: 'grassroots' });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      'grassroots',
      'month', // interval defaults to monthly when omitted
    );
    expect(result).toEqual({ url: 'https://checkout.example.com' });
  });

  it('should pass the annual interval through to createCheckoutSession', async () => {
    const spy = vi
      .spyOn(BillingController.prototype, 'createCheckoutSession')
      .mockResolvedValue({ url: 'https://checkout.example.com' } as any);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    await caller.createCheckout({ plan: 'movement', interval: 'year' });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      'movement',
      'year',
    );
  });

  it('should reject createCheckout with an invalid interval', async () => {
    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.createCheckout({ plan: 'grassroots', interval: 'week' } as any)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should reject createCheckout with an invalid plan', async () => {
    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.createCheckout({ plan: 'enterprise' } as any)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should reject createCheckout with the retired representative plan', async () => {
    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.createCheckout({ plan: 'representative' } as any)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should call createPortalSession on the controller', async () => {
    const spy = vi
      .spyOn(BillingController.prototype, 'createPortalSession')
      .mockResolvedValue({ url: 'https://portal.example.com' } as any);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.createPortal();

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ url: 'https://portal.example.com' });
  });

  it('should call activateMockPlan (with quantity) and cancelMockPlan on the controller', async () => {
    const activateSpy = vi
      .spyOn(BillingController.prototype, 'activateMockPlan')
      .mockResolvedValue({ success: true, plan: 'grassroots' } as any);
    const cancelSpy = vi
      .spyOn(BillingController.prototype, 'cancelMockPlan')
      .mockResolvedValue({ success: true } as any);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await caller.activateMockPlan({ plan: 'grassroots', quantity: 3 });
    expect(activateSpy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      'grassroots',
      3,
      'month',
    );

    await caller.activateMockPlan({ plan: 'grassroots', quantity: 3, interval: 'year' });
    expect(activateSpy).toHaveBeenLastCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      'grassroots',
      3,
      'year',
    );

    await caller.cancelMockPlan();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('should default activateMockPlan quantity to undefined when omitted', async () => {
    const activateSpy = vi
      .spyOn(BillingController.prototype, 'activateMockPlan')
      .mockResolvedValue({ success: true, plan: 'movement' } as any);

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await caller.activateMockPlan({ plan: 'movement' });
    expect(activateSpy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      'movement',
      undefined,
      'month',
    );
  });

  it('should reject activateMockPlan quantity above the max bracket (11, Movement ladder)', async () => {
    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.activateMockPlan({ plan: 'movement', quantity: 12 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should reject non-admin/owner users with FORBIDDEN', async () => {
    vi.restoreAllMocks();
    mockAuthDb('user');

    const caller = BillingRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.getDetails()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('should reject unauthenticated requests with UNAUTHORIZED', async () => {
    const caller = BillingRouter.createCaller({} as any);
    await expect(caller.getDetails()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
