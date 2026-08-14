import { Service } from '@angular/core';

import type {
  AddTurfType,
  AssignTurfType,
  CoverageRequestType,
  CutTurfsType,
  FieldReportRangeType,
  RemoveCanvasserType,
  UpdateCompanionSettingsType,
  UpdateTurfType,
} from '../../../../../../../libs/common/src';

import { TRPCService } from '../../../services/api/trpc-service';
import type { RouterOutputs } from '../../../services/api/trpc-types';

export type TurfListItem = RouterOutputs['canvassing']['getTurfs'][number];
export type TurfDetail = RouterOutputs['canvassing']['getTurfDetail'];
export type TurfDoor = TurfDetail['doors'][number];
export type TurfRosterEntry = TurfDetail['canvassers'][number];
export type TurfCanvasser = RouterOutputs['canvassing']['getCanvassers'][number];
export type FieldSummary = RouterOutputs['canvassing']['getFieldSummary'];
export type InFieldToday = RouterOutputs['canvassing']['getInFieldToday'];
export type FieldReport = RouterOutputs['canvassing']['getFieldReport'];
export type Coverage = RouterOutputs['canvassing']['getCoverage'];
export type CutPreview = RouterOutputs['canvassing']['previewCut'];
export type CanvassLive = RouterOutputs['canvassing']['getLive'];
export type LiveCanvasser = CanvassLive['canvassers'][number];
export type LiveWrappedShift = CanvassLive['wrapped'][number];
export type LiveTurf = CanvassLive['turfs'][number];
export type PersonCanvassLive = RouterOutputs['canvassing']['getPersonLive'];
export type TurfLive = RouterOutputs['canvassing']['getTurfLive'];

@Service()
export class CanvassingService extends TRPCService<unknown> {
  public getTurfs(): Promise<TurfListItem[]> {
    return this.api.canvassing.getTurfs.query();
  }

  public getTurfDetail(turfId: string): Promise<TurfDetail> {
    return this.api.canvassing.getTurfDetail.query(turfId);
  }

  public getFieldSummary(): Promise<FieldSummary> {
    return this.api.canvassing.getFieldSummary.query();
  }

  public getInFieldToday(): Promise<InFieldToday> {
    return this.api.canvassing.getInFieldToday.query();
  }

  /** The whole Live tab in one read. Admin/owner only — the server refuses editors. */
  public getLive(): Promise<CanvassLive> {
    return this.api.canvassing.getLive.query();
  }

  public getPersonLive(personId: string): Promise<PersonCanvassLive> {
    return this.api.canvassing.getPersonLive.query({ person_id: personId });
  }

  public getTurfLive(turfId: string): Promise<TurfLive> {
    return this.api.canvassing.getTurfLive.query({ turf_id: turfId });
  }

  public getFieldReport(input: FieldReportRangeType): Promise<FieldReport> {
    return this.api.canvassing.getFieldReport.query(input);
  }

  public exportFieldReport(input: FieldReportRangeType): Promise<{ filename: string; content: string }> {
    return this.api.canvassing.exportFieldReport.query(input);
  }

  /**
   * How far each turf has been walked, and where its doors are.
   *
   * `input.viewport` is the rectangle the map is showing. Pass none on the first load, before the
   * map has framed itself. Inside that rectangle, few enough doors come back individually and too
   * many come back not at all — the per-turf outlines and their exact counts are always returned
   * and are what the map shades instead. A campaign that has cut a whole riding into turfs has as
   * many doors as it has households, which is far more than a browser can draw.
   */
  public getCoverage(input: CoverageRequestType): Promise<Coverage> {
    return this.api.canvassing.getCoverage.query(input);
  }

  public previewCut(input: CutTurfsType): Promise<CutPreview> {
    return this.api.canvassing.previewCut.query(input);
  }

  public cutTurfs(input: CutTurfsType): Promise<{ created: number; unplaced: number }> {
    return this.api.canvassing.cutTurfs.mutate(input);
  }

  /**
   * Whether this workspace holds any boundary map at all.
   *
   * Read from the boundaries router because canvassing has no endpoint that answers it. A `true`
   * proves nothing about a particular cut — whether a set applies depends on the campaign's
   * jurisdiction, region and chamber, which only the server resolves — so callers must never read
   * it as "this cut will be bounded". The per-cut answer is `previewCut(...).bounded`; this flag
   * only tells apart the two unbounded stories (no maps at all, versus maps that do not apply to
   * this campaign's office).
   */
  public async workspaceHasBoundaryMap(): Promise<boolean> {
    const sets = await this.api.boundaries.list.query();
    return sets.length > 0;
  }

  public assign(input: AssignTurfType): Promise<{ token: string; sent: { email: boolean; sms: boolean } }> {
    return this.api.canvassing.assign.mutate(input);
  }

  public getCanvassers(turfId: string): Promise<TurfCanvasser[]> {
    return this.api.canvassing.getCanvassers.query(turfId);
  }

  public removeCanvasser(input: RemoveCanvasserType): Promise<void> {
    return this.api.canvassing.removeCanvasser.mutate(input).then(() => undefined);
  }

  public getCompanionSettings(): Promise<RouterOutputs['canvassing']['getCompanionSettings']> {
    return this.api.canvassing.getCompanionSettings.query(undefined);
  }

  public updateCompanionSettings(input: UpdateCompanionSettingsType): Promise<void> {
    return this.api.canvassing.updateCompanionSettings.mutate(input).then(() => undefined);
  }

  public retire(turfId: string): Promise<void> {
    return this.api.canvassing.retire.mutate(turfId).then(() => undefined);
  }

  /**
   * `boundary_map_missing` is true when the turf names an area but the map it came from is gone
   * (deleted, or the turf predates boundary maps): doors that left the list were still removed,
   * but none could be added, because the area name can no longer be resolved against any map.
   */
  public refreshFromList(turfId: string): Promise<{ added: number; removed: number; boundary_map_missing: boolean }> {
    return this.api.canvassing.refreshFromList.mutate(turfId);
  }

  public addTurf(input: AddTurfType): Promise<{ id: string }> {
    return this.api.canvassing.addTurf.mutate(input);
  }

  public updateTurf(id: string, data: UpdateTurfType): Promise<void> {
    return this.api.canvassing.updateTurf.mutate({ id, data }).then(() => undefined);
  }
}
