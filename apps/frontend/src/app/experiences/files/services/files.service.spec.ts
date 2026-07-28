import { webcrypto } from 'node:crypto';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesService } from './files.service';

describe('FilesService', () => {
  let service: FilesService;
  let mockApi: any;

  beforeEach(() => {
    mockApi = {
      files: {
        getAll: { query: vi.fn() },
        getUploadUrl: { query: vi.fn() },
        registerFile: { mutate: vi.fn() },
      },
    };

    service = Object.create(FilesService.prototype) as FilesService;
    (service as any).api = mockApi;
    (service as any).ac = new AbortController();

    // jsdom does not implement `crypto.subtle` in this environment, but
    // FilesService.uploadFileDirectly relies on it to hash uploads. Back it
    // with Node's real WebCrypto implementation for these tests.
    vi.stubGlobal('crypto', webcrypto);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should fetch all files scoped by the abort signal', async () => {
    mockApi.files.getAll.query.mockResolvedValue({ rows: [{ id: 'f1' }] });

    const result = await service.getAll({ limit: 10 } as any);

    expect(mockApi.files.getAll.query).toHaveBeenCalledWith({ limit: 10 }, { signal: (service as any).ac.signal });
    expect(result).toEqual({ rows: [{ id: 'f1' }] });
  });

  it('should return placeholder responses for the unsupported CRUD stubs', async () => {
    await expect(service.add({} as any)).resolves.toEqual({});
    await expect(service.count()).resolves.toBe(0);
    await expect(service.getById('x')).resolves.toBeUndefined();
    await expect(service.getTags('x')).resolves.toEqual([]);
    await expect(service.getAllArchived()).resolves.toEqual({ rows: [], count: 0 });
    await expect(service.detachTag('x', 'tag')).resolves.toBe(true);
  });

  it('should reject exportCsv-shaped calls with an empty placeholder payload', async () => {
    const result = await service.exportCsv({} as any);
    expect(result).toEqual({ csv: '', columns: [], fileName: '', rowCount: 0 });
  });

  it('should request an upload URL for a file', async () => {
    mockApi.files.getUploadUrl.query.mockResolvedValue({ uploadUrl: 'https://blob/upload', uploadHandle: 'handle-1' });

    const result = await service.getUploadUrl('report.pdf', 'application/pdf');

    expect(mockApi.files.getUploadUrl.query).toHaveBeenCalledWith({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    });
    expect(result).toEqual({ uploadUrl: 'https://blob/upload', uploadHandle: 'handle-1' });
  });

  it('should register an uploaded file record', async () => {
    mockApi.files.registerFile.mutate.mockResolvedValue({ id: 'f9' });

    const result = await service.registerFile({
      filename: 'a.txt',
      mimeType: 'text/plain',
      uploadHandle: 'handle-9',
      sha256Hex: 'deadbeef',
    });

    expect(mockApi.files.registerFile.mutate).toHaveBeenCalledWith({
      filename: 'a.txt',
      mimeType: 'text/plain',
      uploadHandle: 'handle-9',
      sha256Hex: 'deadbeef',
    });
    expect(result).toEqual({ id: 'f9' });
  });

  it('should hash, upload, and register a file end-to-end via uploadFileDirectly', async () => {
    mockApi.files.getUploadUrl.query.mockResolvedValue({ uploadUrl: 'https://blob/upload', uploadHandle: 'handle-1' });
    mockApi.files.registerFile.mutate.mockResolvedValue({ id: 'f10', filename: 'hello.txt' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const file = createFakeFile('hello world', 'hello.txt', 'text/plain');
    const result = await service.uploadFileDirectly(file);

    expect(mockApi.files.getUploadUrl.query).toHaveBeenCalledWith({ filename: 'hello.txt', mimeType: 'text/plain' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://blob/upload',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/plain' },
      }),
    );
    expect(mockApi.files.registerFile.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'hello.txt',
        mimeType: 'text/plain',
        uploadHandle: 'handle-1',
      }),
    );
    // sha256Hex should have been computed as a lower-case hex string
    const call = mockApi.files.registerFile.mutate.mock.calls[0][0];
    expect(call.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toEqual({ id: 'f10', filename: 'hello.txt' });
  });

  it('should throw when the direct upload to blob storage fails', async () => {
    mockApi.files.getUploadUrl.query.mockResolvedValue({ uploadUrl: 'https://blob/upload', uploadHandle: 'handle-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const file = createFakeFile('data', 'fail.txt', 'text/plain');

    await expect(service.uploadFileDirectly(file)).rejects.toThrow('Upload to storage failed with status 403');
    expect(mockApi.files.registerFile.mutate).not.toHaveBeenCalled();
  });
});

/**
 * jsdom's `File`/`Blob` polyfill in this environment does not implement
 * `arrayBuffer()`, which `FilesService.uploadFileDirectly` relies on to compute
 * a SHA-256 hash. Build a minimal File-shaped object with a working
 * `arrayBuffer()` so the real hashing code path can be exercised.
 */
function createFakeFile(contents: string, filename: string, mimeType: string): File {
  const bytes = new TextEncoder().encode(contents);
  const file = new File([contents], filename, { type: mimeType });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(bytes.buffer),
  });
  return file;
}
