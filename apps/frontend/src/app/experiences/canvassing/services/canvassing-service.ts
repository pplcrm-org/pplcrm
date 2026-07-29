import { Service } from '@angular/core';

import type {
  AddTurfType,
  AssignTurfType,
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

  public getFieldReport(input: FieldReportRangeType): Promise<FieldReport> {
    return this.api.canvassing.getFieldReport.query(input);
  }

  public exportFieldReport(input: FieldReportRangeType): Promise<{ filename: string; content: string }> {
    return this.api.canvassing.exportFieldReport.query(input);
  }

  public getCoverage(input: FieldReportRangeType): Promise<Coverage> {
    return this.api.canvassing.getCoverage.query(input);
  }

  public previewCut(input: CutTurfsType): Promise<CutPreview> {
    return this.api.canvassing.previewCut.query(input);
  }

  public cutTurfs(input: CutTurfsType): Promise<{ created: number; unplaced: number }> {
    return this.api.canvassing.cutTurfs.mutate(input);
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

  public refreshFromList(turfId: string): Promise<{ added: number; removed: number }> {
    return this.api.canvassing.refreshFromList.mutate(turfId);
  }

  public addTurf(input: AddTurfType): Promise<{ id: string }> {
    return this.api.canvassing.addTurf.mutate(input);
  }

  public updateTurf(id: string, data: UpdateTurfType): Promise<void> {
    return this.api.canvassing.updateTurf.mutate({ id, data }).then(() => undefined);
  }
}
