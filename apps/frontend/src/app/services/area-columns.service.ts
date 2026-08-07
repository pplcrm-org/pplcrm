import { Service } from '@angular/core';
import type { BoundaryAreaColumnType } from '@common';

import { TRPCService } from './api/trpc-service';

/**
 * The workspace's boundary maps, as grid columns.
 *
 * A household sits inside several boundaries at once — a riding AND a ward AND a polling division —
 * and the grids show one column per map so each answer has a cell of its own. The people grid and
 * the household grid both ask this service for that list before they build their columns.
 *
 * Shared rather than per-experience because the answer is the same for both grids and neither owns
 * it. It lives next to the campaign context for the same reason: the maps a workspace holds are
 * workspace-level facts a page reads, not something a grid configures.
 */
@Service()
export class AreaColumnsService extends TRPCService<BoundaryAreaColumnType> {
  /**
   * Both grids mount and re-mount constantly (a list, a record page's inline grid, back again) and
   * the answer changes only when an admin adds or deletes a map. One in-flight promise per campaign
   * is remembered so five mounts cost one request.
   */
  private readonly inFlight = new Map<string, Promise<BoundaryAreaColumnType[]>>();

  /**
   * Every boundary map the workspace holds, in display order: seat areas first, then voting
   * subdivisions, then localities.
   *
   * `campaignId` decides which map is marked `is_seat_set` — the one the campaign's own seat is
   * drawn on, which the grids already show under the campaign's own word for it and therefore skip.
   */
  public list(campaignId: string | null): Promise<BoundaryAreaColumnType[]> {
    const key = campaignId ?? '';
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.api.boundaries.areaColumns
      .query({ campaignId }, { signal: this.ac.signal })
      .catch((err: unknown) => {
        // A failed load costs the extra columns, not the grid. Forget it so the next mount retries.
        this.inFlight.delete(key);
        throw err;
      });
    this.inFlight.set(key, request);
    return request;
  }

  /** Drop the memo — call after a boundary map is added, renamed or deleted. */
  public invalidate(): void {
    this.inFlight.clear();
  }
}
