import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { ModuleId, OrgMode } from '@common';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { OrgModeService } from '../../../services/org-mode.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignsService } from '../../campaigns/services/campaigns-service';
import { PersonsService } from '../services/persons-service';
import { PersonCampaignFacts } from './person-campaign-facts';

/**
 * The standing card mixes electoral fields with universal ones under one heading.
 *
 * These tests exist because the failure mode is invisible: nothing errors when a church's person
 * record asks for a voting status, and nothing errors if a later refactor hides the whole card and
 * takes the unsubscribe button with it. Both are only caught by looking.
 */
describe('PersonCampaignFacts', () => {
  let fixture: ComponentFixture<PersonCampaignFacts>;
  let mode: ReturnType<typeof signal<OrgMode>>;
  let modules: ReturnType<typeof signal<ReadonlySet<ModuleId>>>;

  const text = (): string => fixture.nativeElement.textContent ?? '';

  async function build(orgMode: OrgMode, enabled: ModuleId[]): Promise<void> {
    TestBed.resetTestingModule();
    mode = signal<OrgMode>(orgMode);
    modules = signal<ReadonlySet<ModuleId>>(new Set(enabled));

    TestBed.configureTestingModule({
      imports: [PersonCampaignFacts],
      providers: [
        {
          provide: OrgModeService,
          useValue: { mode, enabledModules: modules, isEnabled: (id: ModuleId) => modules().has(id) },
        },
        {
          provide: CampaignContextService,
          useValue: {
            activeCampaign: signal({ id: 'c1', name: 'Riverside Office', status: 'active' }),
            activeCampaignId: signal('c1'),
            isArchivedContext: signal(false),
            ensureLoaded: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CampaignsService,
          useValue: {
            getPersonFacts: vi.fn().mockResolvedValue([]),
            getPersonSubscriptions: vi.fn().mockResolvedValue({
              email: 'someone@example.com',
              do_not_contact: false,
              suppressions: [],
              // Subscribed in the active context, so the card renders the Unsubscribe control —
              // the specific thing that disappears if this card is ever hidden wholesale.
              subscriptions: [{ campaign_id: 'c1', status: 'subscribed', consent_source: 'import', consent_at: null }],
            }),
            setSubscription: vi.fn(),
          },
        },
        { provide: PersonsService, useValue: { update: vi.fn() } },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
      ],
    });

    fixture = TestBed.createComponent(PersonCampaignFacts);
    fixture.componentRef.setInput('personId', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('an electoral workspace', () => {
    beforeEach(async () => {
      await build('campaign', ['canvassing', 'deliveries', 'donations', 'volunteerAccess']);
    });

    it('shows the electoral fields under the campaign heading', () => {
      expect(text()).toContain('Campaign standing');
      expect(text()).toContain('Support level');
      expect(text()).toContain('Voting status');
    });

    it('names the active campaign with a space after "In"', () => {
      // `In` and the campaign name are separate elements; without the nbsp they rendered as
      // "InRiverside Office".
      expect(text().replace(/\u00a0/g, ' ')).toContain('In Riverside Office');
    });
  });

  describe('a church workspace', () => {
    beforeEach(async () => {
      await build('church', ['donations', 'volunteerAccess']);
    });

    it('asks a congregation for no support level and no voting status', () => {
      expect(text()).not.toContain('Support level');
      expect(text()).not.toContain('Voting status');
      expect(text()).not.toContain('Campaign standing');
    });

    it('still offers email consent — the control with legal weight', () => {
      expect(text()).toContain('Email consent');
      expect(text()).toContain('Unsubscribe');
    });

    it('still records volunteer and staff standing', () => {
      expect(text()).toContain('Volunteer status');
      expect(text()).toContain('Staff status');
    });

    it('still offers the do-not-contact override', () => {
      expect(text()).toContain('do-not-contact');
    });
  });

  /**
   * The yard sign follows the Deliveries MODULE, not the org type: a congregation that turns
   * Drop-offs on to run meal boxes should get the control back.
   */
  describe('the yard-sign control', () => {
    it('is hidden when deliveries is off', async () => {
      await build('church', ['donations']);
      expect(text().toLowerCase()).not.toContain('yard sign');
    });

    it('comes back when a non-electoral workspace re-enables deliveries', async () => {
      await build('church', ['donations', 'deliveries']);
      expect(text().toLowerCase()).toContain('yard sign');
    });
  });
});
