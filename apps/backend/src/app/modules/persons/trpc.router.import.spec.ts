import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { PersonsService } from './services/persons.service';
import { PersonsRouter } from './trpc.router';

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

/**
 * The `persons.import` mutation accepts exactly one of two intakes — legacy rows-in-body or an
 * uploaded-file handle — through one input object. These tests pin the boundary: the exclusivity
 * rule, the column-index mapping keys, and that each shape reaches the service correctly
 * narrowed. The other three import routers use the identical structure.
 */
describe('persons.import intake shapes', () => {
  let importSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
    importSpy = vi
      .spyOn(PersonsService.prototype, 'importRows')
      .mockResolvedValue({ import_id: '1', status: 'pending' } as any);
  });

  const caller = () => PersonsRouter.createCaller({ auth: AUTH } as any);

  it('rejects a call with neither rows nor upload_handle', async () => {
    await expect(caller().import({} as any)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('rejects a call carrying both rows and upload_handle', async () => {
    await expect(
      caller().import({ rows: [{ first_name: 'A' }], upload_handle: 'h', mapping: { '0': 'first_name' } } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('rejects an upload_handle without a mapping', async () => {
    await expect(caller().import({ upload_handle: 'h' } as any)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('rejects a mapping keyed by header text instead of a column index', async () => {
    await expect(caller().import({ upload_handle: 'h', mapping: { Phone: 'mobile' } } as any)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects a mapping whose value is not an importable field', async () => {
    await expect(
      caller().import({ upload_handle: 'h', mapping: { '0': 'not_a_real_field' } } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('dispatches the upload shape to the service, narrowed and with defaults applied', async () => {
    const result = await caller().import({
      upload_handle: 'signed-handle',
      mapping: { '0': 'first_name', '3': 'email' },
      tags: ['Volunteers'],
      file_name: 'contacts.csv',
      list_name: 'My list',
    } as any);

    expect(result).toMatchObject({ import_id: '1' });
    expect(importSpy).toHaveBeenCalledTimes(1);
    const input = importSpy.mock.calls[0][0];
    expect(input).toMatchObject({
      upload_handle: 'signed-handle',
      mapping: { '0': 'first_name', '3': 'email' },
      tags: ['Volunteers'],
      file_name: 'contacts.csv',
      duplicate_decision: 'skip', // Zod default applied
      list_name: 'My list',
    });
    expect(input.rows).toBeUndefined();
    expect(input.source_csv).toBeUndefined();
  });

  it('still accepts the legacy rows shape unchanged', async () => {
    await caller().import({
      rows: [{ first_name: 'Ada', email: 'ada@example.com' }],
      tags: [],
      skipped: 2,
      file_name: 'contacts.csv',
      duplicate_decision: 'merge',
      source_csv: 'First,Email\nAda,ada@example.com\n',
      client_skip_reasons: [{ row: 3, reason: 'Email address is not valid' }],
    } as any);

    expect(importSpy).toHaveBeenCalledTimes(1);
    const input = importSpy.mock.calls[0][0];
    expect(input).toMatchObject({
      rows: [{ first_name: 'Ada', email: 'ada@example.com' }],
      skipped: 2,
      duplicate_decision: 'merge',
      source_csv: 'First,Email\nAda,ada@example.com\n',
    });
    expect(input.upload_handle).toBeUndefined();
    expect(input.mapping).toBeUndefined();
  });
});
