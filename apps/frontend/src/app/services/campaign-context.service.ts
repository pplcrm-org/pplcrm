import { computed, Service, signal } from '@angular/core';
import {
  JURISDICTIONS,
  isJurisdictionId,
  seatLabelFor,
  seatLabelPluralFor,
  subdivisionLabelFor,
  subdivisionLabelPluralFor,
} from '@common';
import type { JurisdictionId } from '@common';

import { TRPCService } from './api/trpc-service';
import type { RouterOutputs } from './api/trpc-types';

export type CampaignContextItem = RouterOutputs['campaigns']['getContext']['campaigns'][number];

/**
 * The jurisdiction assumed when there is no active campaign, or when the active campaign carries a
 * value this build does not recognize.
 *
 * `other` is not a failure state. Its vocabulary is the neutral pair ("District", "Subdivision"),
 * which is exactly the right thing to show a screen that has to print a column header before any
 * campaign has been loaded. See `libs/common/src/lib/jurisdictions/other.ts`.
 */
const FALLBACK_JURISDICTION: JurisdictionId = 'other';

/**
 * Campaigns §15 — which context (office or election campaign) the user is working in.
 * The active id is persisted per-user on the backend (profiles.preferences), so it
 * follows the user across devices. Loaded once by the switcher; every campaign-scoped
 * page reads `activeCampaignId()` and passes it to its API calls.
 *
 * It is also the one place the app asks "what word do we use for an electoral area here?".
 * `seatLabel()`, `seatLabelPlural()`, `subdivisionLabel()` and `subdivisionLabelPlural()` resolve
 * the active campaign's own vocabulary, so a grid header, a coverage tab and a turf description all
 * say "Riding" in Ottawa, "Constituency" in Alberta and "Congressional district" in Ohio without
 * any of them knowing why. Every one of them is a non-empty word at all times, including before the
 * first load, because several callers put the value straight into a column header.
 */
@Service()
export class CampaignContextService extends TRPCService<unknown> {
  private readonly _campaigns = signal<CampaignContextItem[]>([]);
  private readonly _activeId = signal<string | null>(null);
  private readonly _loaded = signal(false);

  public readonly campaigns = computed(() => this._campaigns());
  public readonly loaded = computed(() => this._loaded());
  public readonly activeCampaignId = computed(() => this._activeId());
  public readonly activeCampaign = computed(() => {
    const id = this._activeId();
    return id ? (this._campaigns().find((c) => c.id === id) ?? null) : null;
  });
  /** Archived contexts are viewable but read-only — pages use this to gate mutations. */
  public readonly isArchivedContext = computed(() => this.activeCampaign()?.status === 'archived');

  /**
   * The active campaign's jurisdiction, falling back to `other` when nothing is loaded yet or the
   * stored value is not one this build knows. The guard matters: an older row, a test double or a
   * payload from a newer backend can all carry something unexpected, and a label is never the place
   * to surface that.
   */
  public readonly activeJurisdiction = computed<JurisdictionId>(() => {
    const value = this.activeCampaign()?.jurisdiction;
    return isJurisdictionId(value) ? value : FALLBACK_JURISDICTION;
  });

  /** The active campaign's province or state code, or null when it has none. */
  public readonly activeRegion = computed<string | null>(() => {
    const region = this.activeCampaign()?.office_region;
    return typeof region === 'string' && region.trim().length > 0 ? region : null;
  });

  /** The active campaign's spec: its label, its default vocabulary and which inputs it needs. */
  public readonly activeJurisdictionSpec = computed(() => JURISDICTIONS[this.activeJurisdiction()]);

  private readonly seatLabelOverride = computed<string | null>(() => {
    const override = this.activeCampaign()?.seat_label_override;
    return typeof override === 'string' && override.trim().length > 0 ? override : null;
  });

  /**
   * The word for one seat area: "Riding", "Ward", "Constituency", "Congressional district".
   *
   * Resolution order (explicit override, then the regional exception, then the jurisdiction
   * default) lives in `seatLabelFor`, so this signal is only responsible for feeding it the active
   * campaign's three inputs.
   */
  public readonly seatLabel = computed(() =>
    seatLabelFor(this.activeJurisdiction(), this.activeRegion(), this.seatLabelOverride()),
  );

  /** Plural of {@link seatLabel} — "across 12 ridings". */
  public readonly seatLabelPlural = computed(() =>
    seatLabelPluralFor(this.activeJurisdiction(), this.activeRegion(), this.seatLabelOverride()),
  );

  /** The word for one voting subdivision: "Polling division", "Precinct", "Election district". */
  public readonly subdivisionLabel = computed(() =>
    subdivisionLabelFor(this.activeJurisdiction(), this.activeRegion()),
  );

  /** Plural of {@link subdivisionLabel} — "across 40 precincts". */
  public readonly subdivisionLabelPlural = computed(() =>
    subdivisionLabelPluralFor(this.activeJurisdiction(), this.activeRegion()),
  );

  /** Idempotent initial load; safe to call from any component that needs context. */
  public async ensureLoaded(): Promise<void> {
    if (this._loaded()) return;
    await this.refresh();
  }

  /** Re-fetch after campaigns are created/edited/archived. */
  public async refresh(): Promise<void> {
    const ctx = await this.api.campaigns.getContext.query();
    this._campaigns.set(ctx.campaigns);
    this._activeId.set(ctx.active_campaign_id);
    this._loaded.set(true);
  }

  /** Optimistically switch context, then persist the preference server-side. */
  public async setActive(id: string): Promise<void> {
    const previous = this._activeId();
    if (previous === id) return;
    this._activeId.set(id);
    try {
      await this.api.campaigns.setActiveCampaign.mutate(id);
    } catch (err) {
      this._activeId.set(previous);
      throw err;
    }
  }
}
