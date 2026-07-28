import { Service } from '@angular/core';

import type {
  AddDeliveryRequestType,
  CommitDeliveriesType,
  DeliveryRequestStatus,
  ExportCsvInputType,
  ExportCsvResponseType,
  PlanDeliveriesType,
  SetRouteDefaultsType,
  UpdateDeliveryRequestType,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';

import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { RouterOutputs } from '../../../services/api/trpc-types';

export type DeliveryRequestRow = RouterOutputs['deliveries']['getAllRequests']['rows'][number];
export type DeliveryPlanPreview = RouterOutputs['deliveries']['previewPlan'];

/**
 * Deliveries requests + planning service (spec §14). Backs the requests grid and the plan page.
 * Route CRUD lives in DeliveriesRoutesService; both point at the same `deliveries` tRPC router.
 */
@Service()
export class DeliveriesRequestsService extends AbstractAPIService<'delivery_requests', UpdateDeliveryRequestType> {
  protected override readonly endpointName = 'deliveries';

  public getAll(options?: getAllOptionsType): Promise<RouterOutputs['deliveries']['getAllRequests']> {
    return this.api.deliveries.getAllRequests.query(options, { signal: this.ac.signal });
  }

  public getStatusCounts(): Promise<RouterOutputs['deliveries']['getRequestCounts']> {
    return this.api.deliveries.getRequestCounts.query(undefined, { signal: this.ac.signal });
  }

  public getReadyCount(): Promise<number> {
    return this.api.deliveries.getReadyCount.query(undefined, { signal: this.ac.signal });
  }

  public add(row: AddDeliveryRequestType): Promise<{ id: string }> {
    return this.api.deliveries.addRequest.mutate(row);
  }

  public update(id: string, data: UpdateDeliveryRequestType): Promise<{ id: string }> {
    return this.api.deliveries.updateRequestNotes.mutate({ id, data });
  }

  public setStatus(ids: string[], status: DeliveryRequestStatus): Promise<{ updated: number }> {
    return this.api.deliveries.setRequestStatus.mutate({ ids, status });
  }

  /** Yard-sign standing for one household in one campaign (household/person "Yard sign" control). */
  public getSignStatus(householdId: string, campaignId: string): Promise<RouterOutputs['deliveries']['getSignStatus']> {
    return this.api.deliveries.getSignStatus.query(
      { household_id: householdId, campaign_id: campaignId },
      { signal: this.ac.signal },
    );
  }

  public getRouteDefaults(): Promise<RouterOutputs['deliveries']['getRouteDefaults']> {
    return this.api.deliveries.getRouteDefaults.query(undefined, { signal: this.ac.signal });
  }

  public setRouteDefaults(input: SetRouteDefaultsType): Promise<RouterOutputs['deliveries']['setRouteDefaults']> {
    return this.api.deliveries.setRouteDefaults.mutate(input);
  }

  public previewPlan(input: PlanDeliveriesType): Promise<DeliveryPlanPreview> {
    return this.api.deliveries.previewPlan.mutate(input);
  }

  public commitPlan(input: CommitDeliveriesType): Promise<RouterOutputs['deliveries']['commitPlan']> {
    return this.api.deliveries.commitPlan.mutate(input);
  }

  public count(): Promise<number> {
    return this.api.deliveries.getAllRequests
      .query({ startRow: 0, endRow: 1 })
      .then((res: RouterOutputs['deliveries']['getAllRequests']) => res.count ?? 0);
  }

  // --- Unused AbstractAPIService surface (grid toolbar disables these) ---
  public addMany(_rows: AddDeliveryRequestType[]) {
    return Promise.resolve([]);
  }
  public attachTag(_id: string, _tag_name: string) {
    return Promise.resolve();
  }
  public detachTag(_id: string, _tag_name: string) {
    return Promise.resolve(false);
  }
  public getAllArchived(_options?: getAllOptionsType) {
    return Promise.resolve({ rows: [], count: 0 });
  }
  public getById(_id: string): Promise<unknown> {
    return Promise.resolve(null);
  }
  public getTags(_id: string) {
    return Promise.resolve([]);
  }
  public exportCsv(_input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return Promise.reject(new Error('Delivery request export is not available'));
  }
}
