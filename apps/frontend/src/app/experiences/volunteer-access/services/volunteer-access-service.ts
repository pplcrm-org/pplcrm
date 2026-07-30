import { Service, signal } from '@angular/core';

import type { CompanionVolunteerRow } from '../../../../../../../libs/common/src';

import { TRPCService } from '../../../services/api/trpc-service';

/**
 * Staff calls for the companion access layer (Volunteer access page + sidebar
 * badge). The volunteer-facing half is REST in apps/companion — this service
 * is only the admin approve/revoke surface.
 */
@Service()
export class VolunteerAccessService extends TRPCService<'companion_volunteers'> {
  private readonly pending = signal<number | null>(null);

  /**
   * Volunteers awaiting approval, shared with the sidebar badge. `getAll()` restamps it
   * from the rows it just returned, so approving on the page moves the badge immediately
   * — the badge and the list it links to can never disagree.
   */
  public readonly pendingApprovals = this.pending.asReadonly();

  public approve(id: string): Promise<void> {
    return this.api.companionAccess.approve.mutate({ id }) as Promise<void>;
  }

  public async getAll(): Promise<CompanionVolunteerRow[]> {
    const rows = (await this.api.companionAccess.getAll.query()) as CompanionVolunteerRow[];
    this.pending.set(rows.filter((r) => r.status === 'verified').length);
    return rows;
  }

  public pendingCount(): Promise<number> {
    return this.api.companionAccess.pendingCount.query() as Promise<number>;
  }

  /** The sidebar's one-shot fetch, for sessions that never open the page. */
  public async refreshPendingCount(): Promise<void> {
    this.pending.set(await this.pendingCount());
  }

  public revoke(id: string): Promise<void> {
    return this.api.companionAccess.revoke.mutate({ id }) as Promise<void>;
  }

  /** null = follow the workspace `app.canvass_volunteer_roam` setting. */
  public setRoam(id: string, canRoam: boolean | null): Promise<void> {
    return this.api.companionAccess.setRoam.mutate({ id, can_roam: canRoam }) as Promise<void>;
  }
}
