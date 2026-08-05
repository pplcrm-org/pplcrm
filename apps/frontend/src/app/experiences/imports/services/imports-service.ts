import { Service } from '@angular/core';

import { TRPCService } from '../../../services/api/trpc-service';

@Service()
export class ImportsService extends TRPCService<unknown> {
  /**
   * Mint a short-lived write-only SAS URL for the wizard's direct-to-storage CSV upload.
   * The browser PUTs the raw file to `uploadUrl` (header `x-ms-blob-type: BlockBlob`) and
   * passes `uploadHandle` to the entity's import mutation — the server, not the client,
   * names the blob.
   */
  public getUploadUrl(
    filename: string,
    mimeType?: string | null,
  ): Promise<{ uploadUrl: string; uploadHandle: string }> {
    return this.api.imports.getUploadUrl.query({ filename, mimeType: mimeType ?? null });
  }

  public list() {
    return this.api.imports.getAll.query(undefined, { signal: this.ac.signal }).then((rows: any[] | undefined) =>
      (rows ?? []).map((row: any) => ({
        ...row,
        createdAt: row?.createdAt ? new Date(row.createdAt) : new Date(0),
        processedAt: row?.processedAt ? new Date(row.processedAt) : new Date(0),
      })),
    );
  }

  public delete(
    id: string,
    options?: {
      deletePeople?: boolean;
      deleteHouseholds?: boolean;
      deleteCompanies?: boolean;
      deleteTasks?: boolean;
    },
  ) {
    return this.api.imports.delete.mutate({ id, ...options });
  }
}
