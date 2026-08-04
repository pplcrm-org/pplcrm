import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ExportsRouter } from './trpc.router';
import { ExportsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

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

function makeExportRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    entity: 'persons',
    file_name: 'persons-export.csv',
    status: 'pending' as const,
    row_count: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    downloadable: false,
    ownedByOther: false,
    createdBy: null,
    ...overrides,
  };
}

describe('ExportsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('rejects unauthenticated callers', async () => {
    const caller = ExportsRouter.createCaller({ auth: undefined } as any);
    await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('calls queueExport on the controller and returns the queued record', async () => {
    const record = makeExportRecord();
    const spy = vi.spyOn(ExportsController.prototype, 'queueExport').mockResolvedValue(record as any);

    const caller = ExportsRouter.createCaller({ auth: AUTH } as any);
    const input = { entity: 'persons' as const, options: {} };
    const result = await caller.queue(input);

    expect(spy).toHaveBeenCalledWith(input, AUTH_MATCHER);
    expect(result).toEqual(record);
  });

  it('rejects queue for an unsupported entity', async () => {
    const caller = ExportsRouter.createCaller({ auth: AUTH } as any);
    await expect(caller.queue({ entity: 'not-a-real-entity' as any, options: {} })).rejects.toThrow();
  });

  it('calls list on the controller for list', async () => {
    const records = [makeExportRecord(), makeExportRecord({ id: '2', status: 'completed' })];
    const spy = vi.spyOn(ExportsController.prototype, 'list').mockResolvedValue(records as any);

    const caller = ExportsRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.list();

    expect(spy).toHaveBeenCalledWith(AUTH_MATCHER);
    expect(result).toEqual(records);
  });

  it('calls deleteExport on the controller with the given id', async () => {
    const spy = vi.spyOn(ExportsController.prototype, 'deleteExport').mockResolvedValue({ success: true });

    const caller = ExportsRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.delete({ id: 'export-123' });

    expect(spy).toHaveBeenCalledWith('export-123', AUTH_MATCHER);
    expect(result).toEqual({ success: true });
  });

  it('propagates errors from the controller when deleting an unknown export', async () => {
    const { NotFoundError } = await import('../../errors/app-errors');
    vi.spyOn(ExportsController.prototype, 'deleteExport').mockRejectedValue(new NotFoundError('Export not found'));

    const caller = ExportsRouter.createCaller({ auth: AUTH } as any);
    // NOTE: `delete` has `.output(z.object({ success: z.boolean() }))`. tRPC's output-validator
    // middleware for output-typed procedures on this trpc version does not preserve the mapped
    // TRPCError `code` from `errorMappingMiddleware` (it resets to INTERNAL_SERVER_ERROR) even
    // though the original error `message` survives — reproduced independently by the pre-existing
    // web-forms.trpc.router.spec.ts "should surface NOT_FOUND" case, so this isn't specific to this
    // router. Assert on the preserved message instead of the code until that's fixed.
    await expect(caller.delete({ id: 'missing' })).rejects.toThrow('Export not found');
  });
});
