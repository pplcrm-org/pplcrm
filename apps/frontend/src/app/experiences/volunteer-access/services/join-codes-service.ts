import { Service, inject } from '@angular/core';

import type {
  AddJoinCodeType,
  JoinCodePhoneSendResult,
  JoinCodeQr,
  JoinCodeRow,
  UpdateJoinCodeType,
} from '../../../../../../../libs/common/src';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { TRPCService } from '../../../services/api/trpc-service';

/**
 * QR join codes — the staff half of the volunteer front door.
 *
 * Codes belong to a campaign context the same way forms and lists do, so the active
 * context is applied here rather than at every call site (Campaigns §15).
 */
@Service()
export class JoinCodesService extends TRPCService<'campaign_join_codes'> {
  private readonly campaignContext = inject(CampaignContextService);

  public getForCampaign(): Promise<JoinCodeRow[]> {
    return this.api.joinCodes.getForCampaign.query({
      campaign_id: this.campaignContext.activeCampaignId(),
    }) as Promise<JoinCodeRow[]>;
  }

  public create(input: Omit<AddJoinCodeType, 'campaign_id'>): Promise<JoinCodeRow> {
    return this.api.joinCodes.create.mutate({
      ...input,
      campaign_id: this.campaignContext.activeCampaignId(),
    }) as Promise<JoinCodeRow>;
  }

  public update(id: string, data: UpdateJoinCodeType): Promise<JoinCodeRow> {
    return this.api.joinCodes.update.mutate({ id, data }) as Promise<JoinCodeRow>;
  }

  public qr(id: string): Promise<JoinCodeQr> {
    return this.api.joinCodes.qr.query({ id }) as Promise<JoinCodeQr>;
  }

  /**
   * Text yourself the organizer page for this code — the QR to hold up, plus the people
   * who scanned it waiting to be let in. Only ever goes to the mobile on your own profile;
   * `no_mobile` is a real answer, not a failure, so the caller narrates it.
   */
  public sendToMyPhone(id: string): Promise<JoinCodePhoneSendResult> {
    return this.api.joinCodes.sendToMyPhone.mutate({ id }) as Promise<JoinCodePhoneSendResult>;
  }

  /** Retires the current code and mints a replacement — anything printed stops working. */
  public rotate(id: string): Promise<JoinCodeRow> {
    return this.api.joinCodes.rotate.mutate({ id }) as Promise<JoinCodeRow>;
  }

  public revoke(id: string): Promise<void> {
    return this.api.joinCodes.revoke.mutate({ id }) as Promise<void>;
  }
}
