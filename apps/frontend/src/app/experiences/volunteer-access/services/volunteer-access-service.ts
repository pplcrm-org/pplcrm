import { Service } from '@angular/core';

import type { CompanionVolunteerRow } from '../../../../../../../libs/common/src';

import { TRPCService } from '../../../services/api/trpc-service';

/**
 * Staff calls for the companion access layer (Volunteer access page + sidebar
 * badge). The volunteer-facing half is REST in apps/companion — this service
 * is only the admin approve/revoke surface.
 */
@Service()
export class VolunteerAccessService extends TRPCService<'companion_volunteers'> {
  public approve(id: string): Promise<void> {
    return this.api.companionAccess.approve.mutate({ id }) as Promise<void>;
  }

  public getAll(): Promise<CompanionVolunteerRow[]> {
    return this.api.companionAccess.getAll.query() as Promise<CompanionVolunteerRow[]>;
  }

  public pendingCount(): Promise<number> {
    return this.api.companionAccess.pendingCount.query() as Promise<number>;
  }

  public revoke(id: string): Promise<void> {
    return this.api.companionAccess.revoke.mutate({ id }) as Promise<void>;
  }

  /** null = follow the workspace `app.canvass_volunteer_roam` setting. */
  public setRoam(id: string, canRoam: boolean | null): Promise<void> {
    return this.api.companionAccess.setRoam.mutate({ id, can_roam: canRoam }) as Promise<void>;
  }
}
