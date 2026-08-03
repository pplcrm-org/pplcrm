import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignContextService } from './campaign-context.service';
import { ErrorService } from './error.service';
import { TokenService } from './api/token-service';

const CAMPAIGNS = [
  { id: 'c1', name: 'Office', status: 'active' },
  { id: 'c2', name: 'Election 2026', status: 'active' },
  { id: 'c3', name: 'Election 2022', status: 'archived' },
];

/** A campaign row shaped like the context payload, with only the office fields a test cares about. */
function campaignWithOffice(overrides: Record<string, unknown>) {
  return {
    id: 'j1',
    name: 'Office',
    kind: 'office',
    status: 'active',
    startdate: null,
    enddate: null,
    jurisdiction: 'other',
    office_region: null,
    office_locality: null,
    chamber: null,
    seat_type: 'district',
    seat_name: null,
    seat_position: null,
    seat_label_override: null,
    office_title: null,
    ...overrides,
  };
}

describe('CampaignContextService', () => {
  let service: CampaignContextService;
  let mockApi: {
    campaigns: {
      getContext: { query: ReturnType<typeof vi.fn> };
      setActiveCampaign: { mutate: ReturnType<typeof vi.fn> };
    };
  };

  beforeEach(() => {
    mockApi = {
      campaigns: {
        getContext: {
          query: vi.fn().mockResolvedValue({ campaigns: CAMPAIGNS, active_campaign_id: 'c1' }),
        },
        setActiveCampaign: { mutate: vi.fn().mockResolvedValue(undefined) },
      },
    };

    TestBed.configureTestingModule({
      providers: [
        CampaignContextService,
        { provide: ErrorService, useValue: { handle: vi.fn() } },
        { provide: TokenService, useValue: { getAuthToken: vi.fn().mockReturnValue('token') } },
        { provide: Router, useValue: { navigate: vi.fn(), url: '/' } },
      ],
    });

    service = TestBed.inject(CampaignContextService);
    (service as any).api = mockApi;
  });

  it('starts unloaded with no campaigns and no active context', () => {
    expect(service.loaded()).toBe(false);
    expect(service.campaigns()).toEqual([]);
    expect(service.activeCampaignId()).toBeNull();
    expect(service.activeCampaign()).toBeNull();
    expect(service.isArchivedContext()).toBe(false);
  });

  it('refresh() populates campaigns, the active id, and the loaded flag', async () => {
    await service.refresh();

    expect(service.loaded()).toBe(true);
    expect(service.campaigns()).toEqual(CAMPAIGNS);
    expect(service.activeCampaignId()).toBe('c1');
    expect(service.activeCampaign()?.name).toBe('Office');
  });

  it('ensureLoaded() fetches once and is a no-op afterwards', async () => {
    await service.ensureLoaded();
    await service.ensureLoaded();

    expect(mockApi.campaigns.getContext.query).toHaveBeenCalledTimes(1);
  });

  it('ensureLoaded() also no-ops after an explicit refresh()', async () => {
    await service.refresh();
    await service.ensureLoaded();

    expect(mockApi.campaigns.getContext.query).toHaveBeenCalledTimes(1);
  });

  describe('setActive', () => {
    beforeEach(async () => {
      await service.refresh();
    });

    it('no-ops when the id is already active', async () => {
      await service.setActive('c1');

      expect(mockApi.campaigns.setActiveCampaign.mutate).not.toHaveBeenCalled();
    });

    it('switches optimistically — the id flips before the server confirms', async () => {
      let resolveMutate!: () => void;
      mockApi.campaigns.setActiveCampaign.mutate.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveMutate = resolve;
        }),
      );

      const pending = service.setActive('c2');
      expect(service.activeCampaignId()).toBe('c2'); // mid-flight, not yet persisted

      resolveMutate();
      await pending;

      expect(mockApi.campaigns.setActiveCampaign.mutate).toHaveBeenCalledWith('c2');
      expect(service.activeCampaignId()).toBe('c2');
    });

    it('rolls back to the previous context and rethrows when persisting fails', async () => {
      const failure = new Error('server said no');
      mockApi.campaigns.setActiveCampaign.mutate.mockRejectedValue(failure);

      await expect(service.setActive('c2')).rejects.toBe(failure);

      expect(service.activeCampaignId()).toBe('c1');
    });
  });

  describe('derived context state', () => {
    it('activeCampaign() is null when the active id is not in the list', async () => {
      mockApi.campaigns.getContext.query.mockResolvedValue({ campaigns: CAMPAIGNS, active_campaign_id: 'gone' });
      await service.refresh();

      expect(service.activeCampaignId()).toBe('gone');
      expect(service.activeCampaign()).toBeNull();
      expect(service.isArchivedContext()).toBe(false);
    });

    it('isArchivedContext() gates mutations only for an archived active campaign', async () => {
      await service.refresh();
      expect(service.isArchivedContext()).toBe(false);

      await service.setActive('c3');
      expect(service.isArchivedContext()).toBe(true);

      await service.setActive('c2');
      expect(service.isArchivedContext()).toBe(false);
    });
  });

  /**
   * The four label signals every other screen reads. They must never be empty, because several
   * callers put the value straight into a column header.
   */
  describe('electoral vocabulary', () => {
    async function loadOffice(overrides: Record<string, unknown>): Promise<void> {
      mockApi.campaigns.getContext.query.mockResolvedValue({
        campaigns: [campaignWithOffice(overrides)],
        active_campaign_id: 'j1',
      });
      await service.refresh();
    }

    it('falls back to neutral words before anything is loaded', () => {
      expect(service.seatLabel()).toBe('District');
      expect(service.seatLabelPlural()).toBe('Districts');
      expect(service.subdivisionLabel()).toBe('Subdivision');
      expect(service.subdivisionLabelPlural()).toBe('Subdivisions');
      expect(service.activeJurisdiction()).toBe('other');
    });

    it('never returns an empty string, whatever the campaign carries', async () => {
      await loadOffice({ jurisdiction: 'not-a-jurisdiction', seat_label_override: '   ' });

      for (const label of [
        service.seatLabel(),
        service.seatLabelPlural(),
        service.subdivisionLabel(),
        service.subdivisionLabelPlural(),
      ]) {
        expect(label.length).toBeGreaterThan(0);
      }
      expect(service.activeJurisdiction()).toBe('other');
    });

    it('uses the jurisdiction default when there is no exception', async () => {
      await loadOffice({ jurisdiction: 'ca_federal' });

      expect(service.seatLabel()).toBe('Riding');
      expect(service.seatLabelPlural()).toBe('Ridings');
      expect(service.subdivisionLabel()).toBe('Polling division');
      expect(service.subdivisionLabelPlural()).toBe('Polling divisions');
    });

    it('applies the regional exception with nothing configured — Alberta says Constituency', async () => {
      await loadOffice({ jurisdiction: 'ca_provincial', office_region: 'AB' });

      expect(service.seatLabel()).toBe('Constituency');
      expect(service.seatLabelPlural()).toBe('Constituencies');
    });

    it('applies the New York subdivision exception', async () => {
      await loadOffice({ jurisdiction: 'us_state', office_region: 'NY' });

      expect(service.seatLabel()).toBe('Legislative district');
      expect(service.subdivisionLabel()).toBe('Election district');
      expect(service.subdivisionLabelPlural()).toBe('Election districts');
    });

    it("lets the campaign's own override beat the regional exception", async () => {
      await loadOffice({ jurisdiction: 'ca_provincial', office_region: 'AB', seat_label_override: 'Trustee area' });

      expect(service.seatLabel()).toBe('Trustee area');
      expect(service.seatLabelPlural()).toBe('Trustee areas');
      // The override renames the seat only; where you are still decides the subdivision word.
      expect(service.subdivisionLabel()).toBe('Polling division');
    });

    it('exposes the region and the spec alongside the words', async () => {
      await loadOffice({ jurisdiction: 'us_federal', office_region: 'OH' });

      expect(service.activeRegion()).toBe('OH');
      expect(service.activeJurisdictionSpec().label).toBe('United States — federal');
      expect(service.seatLabel()).toBe('Congressional district');
    });
  });
});
