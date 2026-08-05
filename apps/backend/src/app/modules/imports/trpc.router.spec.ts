import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ImportsRouter } from './trpc.router';
import { ImportsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { verifyUploadHandle } from '../../lib/signed-download';
import { StorageService } from '../../lib/storage.service';

function mockAuthDb() {
  const mockQB: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ role: 'owner', verified: true }),
  };
  vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
    selectFrom: vi.fn().mockReturnValue(mockQB),
  } as any);
}

const AUTH = { tenant_id: '1', user_id: '1', session_id: 's1' };
// `isAuthed` merges a `role` field onto `ctx.auth` before calling the
// procedure, so controllers actually receive `{ ...AUTH, role: 'owner' }`.
// Match with objectContaining rather than asserting the exact shape.
const AUTH_MATCHER = expect.objectContaining(AUTH);

describe('ImportsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('rejects unauthenticated callers', async () => {
    const caller = ImportsRouter.createCaller({ auth: undefined } as any);
    await expect(caller.getAll()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('calls list on the controller for getAll', async () => {
    const mockImports = [{ id: '1', file_name: 'test.csv', contactCount: 5 }];
    const spy = vi.spyOn(ImportsController.prototype, 'list').mockResolvedValue(mockImports as any);

    const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.getAll();

    expect(spy).toHaveBeenCalledWith(AUTH_MATCHER);
    expect(result).toEqual(mockImports);
  });

  it('calls deleteImport on the controller with parsed input', async () => {
    const spy = vi.spyOn(ImportsController.prototype, 'deleteImport').mockResolvedValue({ deleted: true } as any);

    const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
    const input = { id: '42', deleteContacts: true, deleteCompanies: false };
    const result = await caller.delete(input);

    expect(spy).toHaveBeenCalledWith(input, AUTH_MATCHER);
    expect(result).toEqual({ deleted: true });
  });

  it('rejects delete when the id is not a valid numeric id', async () => {
    const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
    await expect(caller.delete({ id: 'not-an-id' } as any)).rejects.toThrow();
  });

  it('propagates errors thrown by the controller', async () => {
    vi.spyOn(ImportsController.prototype, 'deleteImport').mockRejectedValue(new Error('boom'));

    const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
    await expect(caller.delete({ id: '1' })).rejects.toThrow();
  });

  describe('getUploadUrl', () => {
    it('mints a SAS for a key under the tenant imports/source prefix and returns a verifiable handle', async () => {
      const sasSpy = vi
        .spyOn(StorageService.prototype, 'generateWriteSasUrl')
        .mockResolvedValue('https://mock-storage.example.com/sas-url');

      const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
      const result = await caller.getUploadUrl({ filename: 'contacts.csv', mimeType: 'text/csv' });

      expect(result.uploadUrl).toBe('https://mock-storage.example.com/sas-url');
      // The SAS is minted for a server-generated key in the retained-source namespace
      // (the retention sweep, delete-import cleanup, and hard-delete sweep all key on it)...
      const signedKey = sasSpy.mock.calls[0]?.[0] as string;
      expect(signedKey).toMatch(new RegExp(`^imports/source/${AUTH.tenant_id}/[0-9a-f-]{36}\\.csv$`));
      // ...but the key itself is never handed to the client — only a signed handle is,
      // and that handle verifies back to the same key for this tenant only.
      expect(result).not.toHaveProperty('storageKey');
      expect(verifyUploadHandle(result.uploadHandle, AUTH.tenant_id)).toBe(signedKey);
      expect(() => verifyUploadHandle(result.uploadHandle, '999')).toThrow();
    });

    it('refuses a blocked content type before minting a SAS', async () => {
      const sasSpy = vi.spyOn(StorageService.prototype, 'generateWriteSasUrl');

      const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
      await expect(
        caller.getUploadUrl({ filename: 'contacts.csv', mimeType: 'application/x-msdownload' }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      expect(sasSpy).not.toHaveBeenCalled();
    });

    it('refuses a blocked file extension before minting a SAS', async () => {
      const sasSpy = vi.spyOn(StorageService.prototype, 'generateWriteSasUrl');

      const caller = ImportsRouter.createCaller({ auth: AUTH } as any);
      await expect(caller.getUploadUrl({ filename: 'payload.exe', mimeType: null })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      expect(sasSpy).not.toHaveBeenCalled();
    });
  });
});
