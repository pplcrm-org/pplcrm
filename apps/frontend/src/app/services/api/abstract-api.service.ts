import { signal, Service } from '@angular/core';
import {
  DataExportRecordType,
  ExportCsvInputType,
  ExportCsvResponseType,
  getAllOptionsType,
  LogInstantExportInputType,
  MAX_BULK_IDS,
  QueueExportInputType,
} from '../../../../../../libs/common/src';
import { TRPCService } from './trpc-service';
import { TRPCClient } from '@trpc/client';
import { TRPCRouter } from '../../../../../backend/src/app/modules/trpc';

import { Models } from '../../../../../../libs/common/src/lib/kysely.models';

@Service()
export abstract class AbstractAPIService<T extends keyof Models, U> extends TRPCService<T> {
  protected abstract readonly endpointName: keyof TRPCClient<TRPCRouter>;

  public readonly refreshCount = signal(0);

  public triggerRefresh() {
    this.refreshCount.update((n) => n + 1);
  }
  public abstract add(row: U, options?: unknown): Promise<Partial<T> | unknown>;

  public abstract addMany(rows: U[]): Promise<Partial<T>[] | unknown>;

  public abstract attachTag(id: string, tag_name: string, type?: 'tag' | 'issue'): Promise<unknown>;

  public abstract count(): Promise<number>;

  public async delete(id: string): Promise<boolean> {
    const endpoint = this.api[this.endpointName] as {
      delete: { mutate: (id: string) => Promise<unknown> };
    };
    if (!endpoint) {
      throw new Error(`Endpoint for "${String(this.endpointName)}" not found on tRPC client.`);
    }
    return (await endpoint.delete.mutate(id)) !== null;
  }

  public async deleteMany(ids: string[]): Promise<boolean> {
    const endpoint = this.api[this.endpointName] as {
      delete: { mutate: (id: string) => Promise<unknown> };
      deleteMany?: { mutate: (ids: string[]) => Promise<unknown> };
    };
    if (!endpoint) {
      throw new Error(`Endpoint for "${String(this.endpointName)}" not found on tRPC client.`);
    }
    if ('deleteMany' in endpoint && endpoint.deleteMany) {
      // The backend caps one deleteMany call at MAX_BULK_IDS ids, while "select all matching"
      // can hold a larger selection — an oversized array was rejected wholesale by input
      // validation and the bulk delete simply failed. Send sequential chunks instead.
      let allOk = true;
      for (let i = 0; i < ids.length; i += MAX_BULK_IDS) {
        allOk = (await endpoint.deleteMany.mutate(ids.slice(i, i + MAX_BULK_IDS))) !== null && allOk;
      }
      return allOk;
    }
    // Fallback for entities without a deleteMany endpoint: bounded parallelism, not one
    // unbounded Promise.all that fires a request per id all at once.
    let allOk = true;
    const FALLBACK_DELETE_CHUNK = 25;
    for (let i = 0; i < ids.length; i += FALLBACK_DELETE_CHUNK) {
      const results = await Promise.all(ids.slice(i, i + FALLBACK_DELETE_CHUNK).map((id) => this.delete(id)));
      allOk = results.every(Boolean) && allOk;
    }
    return allOk;
  }

  /**
   * Attach one tag to many records. The default falls back to one mutation per id for entities
   * without a bulk endpoint; entities that have `attachTagToMany` (persons, households) override
   * this with chunked single-round-trip calls.
   */
  public async attachTagToMany(ids: string[], tag_name: string, type: 'tag' | 'issue' = 'tag'): Promise<void> {
    for (const id of ids) {
      await this.attachTag(id, tag_name, type);
    }
  }

  /**
   * Ids of every row matching `options` (same filters and sort as getAll), fetched ids-only so a
   * 100k-row match costs ~1MB, not hundreds of full rows per page. `capped` is true when the
   * server stopped at its MAX_SELECT_ALL_IDS ceiling — the caller must then say "first N of M
   * selected", never "all M". Returns null for entities without the endpoint; the datagrid then
   * falls back to one full-row page and reports the cap honestly from the response's count.
   */
  public getMatchingIds(
    _options?: getAllOptionsType,
  ): Promise<{ ids: string[]; count: number; capped: boolean } | null> {
    return Promise.resolve(null);
  }

  public abstract detachTag(id: string, tag_name: string, type?: 'tag' | 'issue'): Promise<unknown>;

  public abstract getAll(options?: getAllOptionsType): Promise<{ rows: Record<string, unknown>[]; count: number }>;

  public abstract getAllArchived(
    options?: getAllOptionsType,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }>;

  public abstract getById(id: string): Promise<unknown>;

  public abstract getTags(id: string, type?: 'tag' | 'issue'): Promise<string[]>;

  public abstract update(id: string, data: U, options?: unknown): Promise<Partial<T>[] | unknown>;

  public abstract exportCsv(input: ExportCsvInputType): Promise<ExportCsvResponseType>;

  public queueExport(input: QueueExportInputType): Promise<DataExportRecordType> {
    const exportsEndpoint = this.api.exports as {
      queue: { mutate: (input: QueueExportInputType) => Promise<DataExportRecordType> };
    };
    return exportsEndpoint.queue.mutate(input);
  }

  public logInstantExport(input: LogInstantExportInputType): Promise<DataExportRecordType> {
    const exportsEndpoint = this.api.exports as {
      logInstant: { mutate: (input: LogInstantExportInputType) => Promise<DataExportRecordType> };
    };
    return exportsEndpoint.logInstant.mutate(input);
  }
}
