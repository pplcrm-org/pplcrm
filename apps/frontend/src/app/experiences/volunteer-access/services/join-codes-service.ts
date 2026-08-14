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
 * `silent` suppresses the shared tRPC link's error toast for callers where a
 * failure is an acceptable answer (the print sheet's best-effort QR) — the
 * promise still rejects, so the caller decides what silence means.
 */
export interface JoinCodeCallOpts {
  silent?: boolean;
}

function trpcOpts(opts?: JoinCodeCallOpts): { context: { skipErrorHandler: boolean } } | undefined {
  return opts?.silent ? { context: { skipErrorHandler: true } } : undefined;
}

/**
 * QR join codes — the staff half of the volunteer front door.
 *
 * Codes belong to a campaign context the same way forms and lists do, so the active
 * context is applied here rather than at every call site (Campaigns §15).
 */
@Service()
export class JoinCodesService extends TRPCService<'campaign_join_codes'> {
  private readonly campaignContext = inject(CampaignContextService);

  /**
   * `campaignId` overrides the active context when the caller knows which campaign the code
   * really belongs to — the walk sheet passes its TURF's campaign, because filing the code
   * under whatever campaign happened to be selected minted duplicate live codes for one turf
   * and attached redeeming volunteers to the wrong campaign (REVIEW7 E4).
   */
  public getForCampaign(opts?: JoinCodeCallOpts, campaignId?: string | null): Promise<JoinCodeRow[]> {
    return this.api.joinCodes.getForCampaign.query(
      { campaign_id: campaignId !== undefined ? campaignId : this.campaignContext.activeCampaignId() },
      trpcOpts(opts),
    ) as Promise<JoinCodeRow[]>;
  }

  public create(
    input: Omit<AddJoinCodeType, 'campaign_id'>,
    opts?: JoinCodeCallOpts,
    campaignId?: string | null,
  ): Promise<JoinCodeRow> {
    return this.api.joinCodes.create.mutate(
      {
        ...input,
        campaign_id: campaignId !== undefined ? campaignId : this.campaignContext.activeCampaignId(),
      },
      trpcOpts(opts),
    ) as Promise<JoinCodeRow>;
  }

  public update(id: string, data: UpdateJoinCodeType): Promise<JoinCodeRow> {
    return this.api.joinCodes.update.mutate({ id, data }) as Promise<JoinCodeRow>;
  }

  public qr(id: string, opts?: JoinCodeCallOpts): Promise<JoinCodeQr> {
    return this.api.joinCodes.qr.query({ id }, trpcOpts(opts)) as Promise<JoinCodeQr>;
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
