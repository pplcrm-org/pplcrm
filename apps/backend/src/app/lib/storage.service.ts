import { BlobServiceClient, BlobSASPermissions } from '@azure/storage-blob';
import { env } from '../../env';
import type { Readable } from 'stream';
import { logger } from '../logger';

export class StorageService {
  /** Account-wide CORS is applied once per process — see {@link ensureCorsPolicy}. */
  private static corsApplied = false;

  private serviceClient: BlobServiceClient;
  private containerClient;

  constructor() {
    const connectionString = env.azureStorageConnectionString || 'UseDevelopmentStorage=true';
    const containerName = env.azureStorageContainer || 'uploads';
    this.serviceClient = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = this.serviceClient.getContainerClient(containerName);
  }

  public async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.containerClient.createIfNotExists();
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    await blockBlobClient.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  public async uploadStream(key: string, stream: Readable, contentType: string): Promise<void> {
    await this.containerClient.createIfNotExists();
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    await blockBlobClient.uploadStream(stream, undefined, undefined, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  /**
   * Apply the storage account's CORS policy, once per process.
   *
   * `setProperties` is a SERVICE-wide setting, not per-container — so this is the
   * whole account's policy, and it used to be re-applied on every single upload with
   * `allowedOrigins: '*'` and DELETE in the method list. Browser uploads only ever
   * need to PUT a block blob from the app origin, so that is all this grants.
   */
  private async ensureCorsPolicy(): Promise<void> {
    if (StorageService.corsApplied) return;
    StorageService.corsApplied = true;
    try {
      await this.serviceClient.setProperties({
        cors: [
          {
            allowedOrigins: env.appUrl,
            allowedMethods: 'PUT,OPTIONS',
            allowedHeaders: 'content-type,x-ms-blob-type',
            exposedHeaders: '',
            maxAgeInSeconds: 3600,
          },
        ],
      });
    } catch (err) {
      // Don't wedge the process on a transient failure — let the next upload retry.
      StorageService.corsApplied = false;
      logger.warn({ err }, 'Failed to set storage service CORS properties');
    }
  }

  /**
   * The blob's real size in bytes, or null if it cannot be read.
   *
   * Callers must not trust a client-declared size: the browser uploads straight to
   * Azure via a write SAS, so the only honest byte count is the one the account reports.
   */
  public async getSizeBytes(key: string): Promise<number | null> {
    try {
      const properties = await this.containerClient.getBlockBlobClient(key).getProperties();
      return typeof properties.contentLength === 'number' ? properties.contentLength : null;
    } catch (err) {
      logger.warn({ err }, `Failed to read blob size for ${key}`);
      return null;
    }
  }

  public async generateWriteSasUrl(key: string, expiryMinutes = 15): Promise<string> {
    await this.containerClient.createIfNotExists();
    await this.ensureCorsPolicy();

    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    const permissions = BlobSASPermissions.parse('w');
    const expiresOn = new Date();
    expiresOn.setMinutes(expiresOn.getMinutes() + expiryMinutes);
    return await blockBlobClient.generateSasUrl({
      permissions,
      expiresOn,
    });
  }

  public async download(key: string): Promise<Buffer> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    const downloadBlockBlobResponse = await blockBlobClient.download(0);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = downloadBlockBlobResponse.readableStreamBody;
      if (!stream) {
        reject(new Error('No readable stream body in blob response'));
        return;
      }
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err) => reject(err));
    });
  }

  public async delete(key: string): Promise<void> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    await blockBlobClient.deleteIfExists();
  }
}
