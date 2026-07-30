import { Service } from '@angular/core';

import type {
  DeliverySkipReason,
  ExportCsvInputType,
  ExportCsvResponseType,
  UpdateDeliveryRouteType,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';

import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { RouterOutputs } from '../../../services/api/trpc-types';

export type DeliveryRouteRow = RouterOutputs['deliveries']['getAllRoutes']['rows'][number];
export type DeliveryRouteDetail = RouterOutputs['deliveries']['getRouteById'];
export type DeliveryRouteStop = DeliveryRouteDetail['stops'][number];

/** Deliveries routes service (spec §14): routes grid, detail, assignment, reorder, share links. */
@Service()
export class DeliveriesRoutesService extends AbstractAPIService<'delivery_routes', UpdateDeliveryRouteType> {
  protected override readonly endpointName = 'deliveries';

  public getAll(options?: getAllOptionsType): Promise<RouterOutputs['deliveries']['getAllRoutes']> {
    return this.api.deliveries.getAllRoutes.query(options, { signal: this.ac.signal });
  }

  /**
   * Route counts keyed by status (`draft`, `assigned`, `in_progress`, `completed`, `canceled`).
   * `skipErrorHandler` because this only feeds the Routes tab badge — a failed count must not
   * toast over the page the user is actually working on; the caller just drops the badge.
   */
  public getStatusCounts(): Promise<Record<string, number>> {
    return this.api.deliveries.getRouteCounts.query(undefined, {
      signal: this.ac.signal,
      context: { skipErrorHandler: true },
    });
  }

  public getById(id: string): Promise<DeliveryRouteDetail> {
    return this.api.deliveries.getRouteById.query(id);
  }

  public update(id: string, data: UpdateDeliveryRouteType): Promise<{ id: string }> {
    return this.api.deliveries.updateRoute.mutate({ id, data });
  }

  public assignVolunteer(route_id: string, person_id: string | null) {
    return this.api.deliveries.assignVolunteer.mutate({ route_id, person_id });
  }

  /** Mints a fresh personal link and emails/texts it to the assigned volunteer (retires the old link). */
  public resendVolunteerLink(route_id: string) {
    return this.api.deliveries.resendVolunteerLink.mutate({ route_id });
  }

  public setStatus(route_id: string, status: 'in_progress' | 'completed' | 'canceled') {
    return this.api.deliveries.setRouteStatus.mutate({ route_id, status });
  }

  public override delete(id: string): Promise<boolean> {
    return this.api.deliveries.deleteRoute.mutate(id).then((r) => r !== null);
  }

  public stopAction(
    route_id: string,
    stop_id: string,
    action: 'deliver' | 'skip' | 'remove',
    reason?: DeliverySkipReason | null,
  ) {
    return this.api.deliveries.stopAction.mutate({ route_id, stop_id, action, reason: reason ?? null });
  }

  public reorderStop(route_id: string, stop_id: string, direction: 'up' | 'down') {
    return this.api.deliveries.reorderStop.mutate({ route_id, stop_id, direction });
  }

  /** Drag-to-reorder: the full new order of the route's pending stop ids. */
  public reorderStops(route_id: string, ordered_stop_ids: string[]) {
    return this.api.deliveries.reorderStops.mutate({ route_id, ordered_stop_ids });
  }

  public mintShareLink(route_id: string, regenerate = false) {
    return this.api.deliveries.mintShareLink.mutate({ route_id, regenerate });
  }

  public revokeShareLink(route_id: string) {
    return this.api.deliveries.revokeShareLink.mutate({ route_id });
  }

  public count(): Promise<number> {
    return this.api.deliveries.getAllRoutes
      .query({ startRow: 0, endRow: 1 })
      .then((res: RouterOutputs['deliveries']['getAllRoutes']) => res.count ?? 0);
  }

  // --- Unused AbstractAPIService surface ---
  public add(_row: UpdateDeliveryRouteType): Promise<unknown> {
    return Promise.reject(new Error('Routes are created from the plan page'));
  }
  public addMany(_rows: UpdateDeliveryRouteType[]) {
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
  public getTags(_id: string) {
    return Promise.resolve([]);
  }
  public exportCsv(_input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return Promise.reject(new Error('Route export is not available'));
  }
}
