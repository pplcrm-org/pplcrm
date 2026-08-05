import { describe, expect, it, vi } from 'vitest';

import { MAX_IMPORT_FILE_BYTES } from '../../../../../../libs/common/src';
import { jobPayloadSchema } from '../../lib/jobs/job-payloads';
import { signUploadHandle } from '../../lib/signed-download';
import type { StorageService } from '../../lib/storage.service';
import type { ImportsRepo } from './repositories/imports.repo';
import { createUploadImport } from './upload-intake';

const AUTH = { tenant_id: '1', user_id: '9', session_id: 's1' } as any;

function makeRepo(savedId: string | null = '42') {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const trx = { insertInto: vi.fn(() => insertChain) };
  const repo = {
    add: vi.fn(async () => (savedId ? { id: savedId } : null)),
    transaction: () => ({ execute: async (fn: (t: unknown) => Promise<unknown>) => fn(trx) }),
  };
  return { repo: repo as unknown as ImportsRepo, trx, insertChain, addSpy: repo.add };
}

function makeStorage(size: number | null) {
  const getSizeBytes = vi.fn(async () => size);
  return { storage: { getSizeBytes } as unknown as StorageService, getSizeBytes };
}

function baseArgs() {
  const { repo, trx, insertChain, addSpy } = makeRepo();
  const { storage, getSizeBytes } = makeStorage(1024);
  const args: any = {
    auth: AUTH,
    importsRepo: repo,
    storageService: storage,
    source: 'persons' as const,
    input: {
      upload_handle: signUploadHandle(`imports/source/${AUTH.tenant_id}/abc.csv`, AUTH.tenant_id),
      mapping: { '0': 'first_name', '2': 'email' },
      file_name: 'contacts.csv',
    },
    fallbackFileName: 'Imported-20260804.csv',
    tagName: 'Imported-20260804',
    jobExtras: { campaign_id: '3', tags: ['Imported-20260804'], duplicate_decision: 'skip' as const },
  };
  return { trx, insertChain, addSpy, getSizeBytes, args };
}

describe('createUploadImport handle verification', () => {
  it('refuses a garbage handle', async () => {
    const { args } = baseArgs();
    args.input = { ...args.input, upload_handle: 'not-a-real-handle' };
    await expect(createUploadImport(args)).rejects.toThrow(/upload handle/i);
  });

  it('refuses a handle minted for another tenant', async () => {
    const { args } = baseArgs();
    args.input = { ...args.input, upload_handle: signUploadHandle('imports/source/999/abc.csv', '999') };
    await expect(createUploadImport(args)).rejects.toThrow(/upload handle/i);
  });

  it('refuses a valid handle whose key is outside the imports/source namespace', async () => {
    // files.getUploadUrl mints handles with the same signing scope but for other namespaces;
    // an import must never read those (retention + delete cascades key on imports/source).
    const { args, getSizeBytes } = baseArgs();
    args.input = {
      ...args.input,
      upload_handle: signUploadHandle(`files/${AUTH.tenant_id}/other.csv`, AUTH.tenant_id),
    };
    await expect(createUploadImport(args)).rejects.toThrow(/cannot be imported/i);
    expect(getSizeBytes).not.toHaveBeenCalled();
  });
});

describe('createUploadImport size + mapping checks', () => {
  it('refuses when the blob does not exist (size unreadable)', async () => {
    const { args } = baseArgs();
    const { storage } = makeStorage(null);
    args.storageService = storage;
    await expect(createUploadImport(args)).rejects.toThrow(/could not be found/i);
  });

  it('refuses an empty upload', async () => {
    const { args } = baseArgs();
    args.storageService = makeStorage(0).storage;
    await expect(createUploadImport(args)).rejects.toThrow(/could not be found|empty/i);
  });

  it('refuses a file over the import size cap, using the real size from storage', async () => {
    const { args, addSpy } = baseArgs();
    args.storageService = makeStorage(MAX_IMPORT_FILE_BYTES + 1).storage;
    await expect(createUploadImport(args)).rejects.toThrow(/at most 50 MB/i);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the size cap', async () => {
    const { args } = baseArgs();
    args.storageService = makeStorage(MAX_IMPORT_FILE_BYTES).storage;
    await expect(createUploadImport(args)).resolves.toMatchObject({ import_id: '42' });
  });

  it('refuses an empty mapping', async () => {
    const { args, getSizeBytes } = baseArgs();
    args.input = { ...args.input, mapping: {} };
    await expect(createUploadImport(args)).rejects.toThrow(/at least one column/i);
    expect(getSizeBytes).not.toHaveBeenCalled();
  });
});

describe('createUploadImport success path', () => {
  it('records the import and enqueues a typed import_csv job in the same transaction', async () => {
    const { args, addSpy, trx, insertChain } = baseArgs();
    const result = await createUploadImport(args);

    expect(result).toEqual({ import_id: '42', file_name: 'contacts.csv' });

    // The data_imports row: pending, size from storage (never the client), row_count deferred
    // to the job, and the blob key retained as source_file_key so retention/delete cover it.
    const row = addSpy.mock.calls[0]?.[0]?.row as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: '1',
      source: 'persons',
      file_name: 'contacts.csv',
      status: 'pending',
      row_count: 0,
      source_file_key: `imports/source/${AUTH.tenant_id}/abc.csv`,
      source_file_size: 1024,
      tag_name: 'Imported-20260804',
    });

    // The job is inserted through the SAME transaction object (transactional outbox).
    expect(trx.insertInto).toHaveBeenCalledWith('background_jobs');
    const jobValues = insertChain.values.mock.calls[0]?.[0] as { payload: string; tenant_id: string };
    expect(jobValues.tenant_id).toBe('1');

    // The queued payload parses against the typed job schema and carries the mapping.
    const parsed = jobPayloadSchema.safeParse(JSON.parse(jobValues.payload));
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'import_csv') {
      expect(parsed.data.import_id).toBe('42');
      expect(parsed.data.source).toBe('persons');
      expect(parsed.data.storage_key).toBe(`imports/source/${AUTH.tenant_id}/abc.csv`);
      expect(parsed.data.mapping).toEqual({ '0': 'first_name', '2': 'email' });
      expect(parsed.data.duplicate_decision).toBe('skip');
    } else {
      throw new Error('Queued payload did not parse as an import_csv job');
    }
  });

  it('falls back to the generated file name when the client sent none', async () => {
    const { args } = baseArgs();
    args.input = { ...args.input, file_name: '   ' };
    await expect(createUploadImport(args)).resolves.toMatchObject({ file_name: 'Imported-20260804.csv' });
  });
});
