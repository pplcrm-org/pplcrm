import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SettingsRouter } from './trpc.router';
import { SettingsController } from './controller';
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

const auth = { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null };

describe('SettingsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb('owner');
  });

  it('should call getSnapshot on the controller', async () => {
    const mockSnapshot = { 'communications.default_from_email': 'a@b.com' };
    const spy = vi.spyOn(SettingsController.prototype, 'getSnapshot').mockResolvedValue(mockSnapshot as any);

    const caller = SettingsRouter.createCaller({ auth } as any);
    const result = await caller.getSnapshot();

    expect(spy).toHaveBeenCalledWith(auth);
    expect(result).toEqual(mockSnapshot);
  });

  it('should call upsert on the controller with the entries', async () => {
    const mockResult = { 'sla.tasks_hours': 24 };
    const spy = vi.spyOn(SettingsController.prototype, 'upsert').mockResolvedValue(mockResult as any);

    const caller = SettingsRouter.createCaller({ auth } as any);
    const entries = [{ key: 'sla.tasks_hours', value: 24 }];
    const result = await caller.upsert({ entries });

    expect(spy).toHaveBeenCalledWith(auth, entries);
    expect(result).toEqual(mockResult);
  });

  it('should reject upsert with an empty entries array', async () => {
    const caller = SettingsRouter.createCaller({ auth } as any);
    await expect(caller.upsert({ entries: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should reject upsert for non-admin/owner roles with FORBIDDEN', async () => {
    vi.restoreAllMocks();
    mockAuthDb('user');

    const caller = SettingsRouter.createCaller({ auth } as any);
    await expect(caller.upsert({ entries: [{ key: 'foo', value: 'bar' }] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('should call requestEmailVerification with the email', async () => {
    const spy = vi
      .spyOn(SettingsController.prototype, 'requestEmailVerification')
      .mockResolvedValue({ success: true } as any);

    const caller = SettingsRouter.createCaller({ auth } as any);
    const result = await caller.requestEmailVerification({ email: 'a@b.com' });

    expect(spy).toHaveBeenCalledWith(auth, 'a@b.com');
    expect(result).toEqual({ success: true });
  });

  it('should reject requestEmailVerification with an invalid email', async () => {
    const caller = SettingsRouter.createCaller({ auth } as any);
    await expect(caller.requestEmailVerification({ email: 'not-an-email' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should call verifySenderEmail without requiring auth (public procedure)', async () => {
    const spy = vi
      .spyOn(SettingsController.prototype, 'verifySenderEmail')
      .mockResolvedValue({ success: true, email: 'a@b.com' } as any);

    const caller = SettingsRouter.createCaller({} as any);
    const result = await caller.verifySenderEmail({ token: 'sometoken' });

    expect(spy).toHaveBeenCalledWith('sometoken');
    expect(result).toEqual({ success: true, email: 'a@b.com' });
  });

  // The settings router used to carry its own scheduleTenantDeletion / cancelTenantDeletion
  // procedures. They had no callers: the account page and the cancel-deletion page both call the
  // auth router's versions, which additionally email the cancel link. The duplicates were removed
  // so the two could not drift apart, and the test that exercised them went with them.

  it('should call addVerifiedDomain, verifyVerifiedDomain, and deleteVerifiedDomain with the domain', async () => {
    const addSpy = vi.spyOn(SettingsController.prototype, 'addVerifiedDomain').mockResolvedValue([] as any);
    const verifySpy = vi.spyOn(SettingsController.prototype, 'verifyVerifiedDomain').mockResolvedValue([] as any);
    const deleteSpy = vi.spyOn(SettingsController.prototype, 'deleteVerifiedDomain').mockResolvedValue([] as any);

    const caller = SettingsRouter.createCaller({ auth } as any);

    await caller.addVerifiedDomain({ domain: 'example.com' });
    // The link subdomain is optional — the controller falls back to the default.
    expect(addSpy).toHaveBeenCalledWith(auth, 'example.com', undefined);

    await caller.addVerifiedDomain({ domain: 'example.com', linkSubdomain: 'links' });
    expect(addSpy).toHaveBeenCalledWith(auth, 'example.com', 'links');

    await caller.verifyVerifiedDomain({ domain: 'example.com' });
    expect(verifySpy).toHaveBeenCalledWith(auth, 'example.com');

    await caller.deleteVerifiedDomain({ domain: 'example.com' });
    expect(deleteSpy).toHaveBeenCalledWith(auth, 'example.com');
  });

  it('should reject addVerifiedDomain with an empty domain', async () => {
    const caller = SettingsRouter.createCaller({ auth } as any);
    await expect(caller.addVerifiedDomain({ domain: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should pass a link subdomain change through to the controller', async () => {
    const spy = vi.spyOn(SettingsController.prototype, 'setLinkSubdomain').mockResolvedValue([] as any);
    const caller = SettingsRouter.createCaller({ auth } as any);

    await caller.setLinkSubdomain({ domain: 'example.com', subdomain: 'go' });
    expect(spy).toHaveBeenCalledWith(auth, 'example.com', 'go');

    await expect(caller.setLinkSubdomain({ domain: 'example.com', subdomain: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should reject unauthenticated requests to protected procedures with UNAUTHORIZED', async () => {
    const caller = SettingsRouter.createCaller({} as any);
    await expect(caller.getSnapshot()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
