import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { OrgModeService } from '../../../services/org-mode.service';
import { CampaignsService } from '../services/campaigns-service';
import { CampaignFormComponent } from './campaign-form';

/**
 * The office card asks one question at a time, and each answer decides whether the next question is
 * meaningful. These tests pin the disclosure order and, just as importantly, pin that a hidden
 * question can never leave a stale answer behind: a leftover chamber on a jurisdiction that has no
 * chambers would fail validation on a field nobody can see, which reads as a Save button that
 * silently does nothing.
 */
describe('CampaignFormComponent', () => {
  let component: CampaignFormComponent;
  let fixture: ComponentFixture<CampaignFormComponent>;
  let mockCampaignsSvc: {
    getById: ReturnType<typeof vi.fn>;
    getAreas: ReturnType<typeof vi.fn>;
    getAreaSuggestions: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    triggerRefresh: ReturnType<typeof vi.fn>;
  };
  let mockAlerts: { showError: ReturnType<typeof vi.fn>; showSuccess: ReturnType<typeof vi.fn> };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  let mockContext: { refresh: ReturnType<typeof vi.fn> };
  let orgMode: { mode: ReturnType<typeof signal<string>> };

  beforeEach(() => {
    mockCampaignsSvc = {
      getById: vi.fn(),
      getAreas: vi.fn().mockResolvedValue([]),
      getAreaSuggestions: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ id: 'new-id' }),
      update: vi.fn().mockResolvedValue({ id: 'c-1' }),
      triggerRefresh: vi.fn(),
    };
    mockAlerts = { showError: vi.fn(), showSuccess: vi.fn() };
    mockRouter = { navigate: vi.fn() };
    mockContext = { refresh: vi.fn().mockResolvedValue(undefined) };
    orgMode = { mode: signal<string>('campaign') };
  });

  /**
   * The id input is bound before the first change detection, which is the order the router uses.
   * Binding it afterwards would let ngOnInit run in "new campaign" mode and never load anything.
   */
  async function createComponent(id?: string): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CampaignFormComponent],
      providers: [
        { provide: CampaignsService, useValue: mockCampaignsSvc },
        { provide: AlertService, useValue: mockAlerts },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: {} },
        { provide: CampaignContextService, useValue: mockContext },
        { provide: OrgModeService, useValue: orgMode },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CampaignFormComponent);
    component = fixture.componentInstance;
    if (id) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Sets the office answers, then lets the disclosure effect run. */
  function setOffice(values: Record<string, string>): void {
    component['payload'].update((p) => ({ ...p, ...values }));
    fixture.detectChanges();
  }

  it('starts with no office declared, which is a normal state and not an error', async () => {
    await createComponent();

    expect(component['jurisdiction']()).toBe('other');
    expect(component['showRegion']()).toBe(false);
    expect(component['showLocality']()).toBe(false);
    expect(component['showChamber']()).toBe(false);
    expect(component['seatWord']()).toBe('District');
  });

  describe('progressive disclosure', () => {
    it('Canadian federal asks for no region, no locality and no chamber', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'ca_federal' });

      expect(component['showRegion']()).toBe(false);
      expect(component['showLocality']()).toBe(false);
      expect(component['showChamber']()).toBe(false);
      // Every Commons seat is contested in a riding, so there is nothing to choose.
      expect(component['showSeatType']()).toBe(false);
      expect(component['showSeatName']()).toBe(true);
      expect(component['seatWord']()).toBe('Riding');
    });

    it('Canadian provincial asks for a province and names the seat in that province’s own word', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'ca_provincial', office_region: 'AB' });

      expect(component['showRegion']()).toBe(true);
      expect(component['regionTerm']()).toBe('province or territory');
      expect(component['seatWord']()).toBe('Constituency');
    });

    it('municipal asks for a locality as well as a province', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'ca_municipal', office_region: 'ON', office_locality: 'Toronto' });

      expect(component['showRegion']()).toBe(true);
      expect(component['showLocality']()).toBe(true);
      expect(component['showSeatType']()).toBe(true);
      expect(component['seatWord']()).toBe('Ward');
    });

    it('US state is the only jurisdiction that asks which chamber', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_state', office_region: 'AZ' });

      expect(component['showChamber']()).toBe(true);
      expect(component['showSeatPosition']()).toBe(true);
      expect(component['seatWord']()).toBe('Legislative district');
    });

    it('stops asking which chamber once the seat is statewide, which sits in no chamber', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_state', office_region: 'AZ' });
      expect(component['showChamber']()).toBe(true);

      setOffice({ seat_type: 'at_large' });
      expect(component['showChamber']()).toBe(false);
    });

    it('suggests the jurisdiction’s own office title in the empty title field', async () => {
      await createComponent();
      // 'other' offers Candidate first; a hard-coded "MP" would be wrong for most jurisdictions.
      expect(component['officeTitlePlaceholder']()).toBe('Candidate');

      setOffice({ jurisdiction: 'ca_federal' });
      expect(component['officeTitlePlaceholder']()).toBe('MP');
    });

    it('US federal asks for a state but not a chamber', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_federal', office_region: 'OH' });

      expect(component['showRegion']()).toBe(true);
      expect(component['regionTerm']()).toBe('state');
      expect(component['showChamber']()).toBe(false);
      expect(component['showSeatPosition']()).toBe(false);
      expect(component['seatWord']()).toBe('Congressional district');
    });

    it('names the six single-district states so nobody hunts for a district number', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_federal', office_region: 'WY' });
      expect(component['isSingleDistrictState']()).toBe(true);

      setOffice({ office_region: 'OH' });
      expect(component['isSingleDistrictState']()).toBe(false);
    });

    it('hides the seat name once the seat is at large, and says what area it covers', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_federal', office_region: 'OH', seat_type: 'at_large' });

      expect(component['showSeatName']()).toBe(false);
      expect(component['atLargeArea']()).toBe('Ohio');
    });

    it("lets the campaign's own word override the automatic one, live", async () => {
      await createComponent();
      setOffice({ jurisdiction: 'ca_provincial', office_region: 'AB', seat_label_override: 'Trustee area' });

      expect(component['seatWord']()).toBe('Trustee area');
      expect(component['seatWordLower']()).toBe('trustee area');
    });

    it('offers the office titles of the chosen jurisdiction, and fills the free-text field', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'ca_municipal', office_region: 'ON', office_locality: 'Toronto' });

      expect(component['officeTitles']()).toContain('Councillor');
      component['useOfficeTitle']('Councillor');
      expect(component['payload']().office_title).toBe('Councillor');
    });
  });

  describe('answers that no longer apply are dropped', () => {
    it('clears a chamber when the jurisdiction stops having chambers', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_state', office_region: 'AZ', chamber: 'lower' });
      expect(component['payload']().chamber).toBe('lower');

      setOffice({ jurisdiction: 'us_federal' });
      expect(component['payload']().chamber).toBe('');
    });

    it('clears a locality and a region when the jurisdiction stops asking for them', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'ca_municipal', office_region: 'ON', office_locality: 'Toronto' });

      setOffice({ jurisdiction: 'ca_federal' });
      expect(component['payload']().office_locality).toBe('');
      expect(component['payload']().office_region).toBe('');
    });

    it('forces a district seat where the level of government has no at-large seats', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_federal', office_region: 'OH', seat_type: 'at_large' });
      expect(component['payload']().seat_type).toBe('at_large');

      setOffice({ jurisdiction: 'ca_federal' });
      expect(component['payload']().seat_type).toBe('district');
    });

    it('clears the seat name when the seat becomes at large', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_federal', office_region: 'OH', seat_name: 'OH-3' });

      setOffice({ seat_type: 'at_large' });
      expect(component['payload']().seat_name).toBe('');
    });

    it('clears a chosen chamber when the seat becomes statewide', async () => {
      await createComponent();
      setOffice({ jurisdiction: 'us_state', office_region: 'AZ', chamber: 'lower' });
      expect(component['payload']().chamber).toBe('lower');

      setOffice({ seat_type: 'at_large' });
      expect(component['payload']().chamber).toBe('');
    });
  });

  describe('validation', () => {
    it('accepts a campaign with a name and nothing else, dates included', async () => {
      await createComponent();
      component['payload'].update((p) => ({ ...p, name: 'Riverdale 2026' }));
      fixture.detectChanges();

      expect(component['form']().invalid()).toBe(false);
    });

    it('asks for the seat by its own name once a jurisdiction is chosen', async () => {
      await createComponent();
      component['payload'].update((p) => ({ ...p, name: 'Ottawa Centre 2026', jurisdiction: 'ca_federal' }));
      fixture.detectChanges();

      expect(component['form']().invalid()).toBe(true);

      setOffice({ seat_name: 'Ottawa Centre' });
      expect(component['form']().invalid()).toBe(false);
    });

    it('does not block a US state campaign for a chamber it has already chosen', async () => {
      await createComponent();
      component['payload'].update((p) => ({
        ...p,
        name: 'AZ LD-12',
        jurisdiction: 'us_state',
        office_region: 'AZ',
        seat_name: 'LD-12',
        chamber: 'lower',
      }));
      fixture.detectChanges();

      expect(component['form']().invalid()).toBe(false);
    });

    it('accepts a statewide office with no chamber, which it does not have', async () => {
      // A governor or attorney-general race used to be unsavable: the schema demanded a chamber
      // the office does not sit in, on a field the form no longer shows.
      await createComponent();
      component['payload'].update((p) => ({
        ...p,
        name: 'AZ Governor 2026',
        jurisdiction: 'us_state',
        office_region: 'AZ',
        seat_type: 'at_large',
      }));
      fixture.detectChanges();

      expect(component['form']().invalid()).toBe(false);
    });
  });

  describe('saving', () => {
    it('sends all nine office fields, with unanswered ones as null', async () => {
      await createComponent();
      component['payload'].update((p) => ({
        ...p,
        name: 'Ohio 3rd',
        jurisdiction: 'us_federal',
        office_region: 'OH',
        seat_name: 'OH-3',
        office_title: 'Representative',
      }));
      fixture.detectChanges();

      await component['save']();

      expect(mockCampaignsSvc.add).toHaveBeenCalledWith(
        expect.objectContaining({
          jurisdiction: 'us_federal',
          office_region: 'OH',
          office_locality: null,
          chamber: null,
          seat_type: 'district',
          seat_name: 'OH-3',
          seat_position: null,
          seat_label_override: null,
          office_title: 'Representative',
        }),
      );
    });

    it('leaves the office fields alone on update in a workspace that runs no elections', async () => {
      orgMode.mode.set('nonprofit');
      mockCampaignsSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Our work', jurisdiction: 'other' });

      await createComponent('c-1');

      expect(component['isElectoral']()).toBe(false);

      await component['save']();

      const sent = mockCampaignsSvc.update.mock.calls[0][1];
      expect(sent).not.toHaveProperty('jurisdiction');
      expect(sent).not.toHaveProperty('seat_name');
    });
  });

  /**
   * A save replaces the campaign's stored areas with exactly the list it sends, and omitting the
   * list is how the API is told to leave them alone. So the form may only send a list it has
   * actually read back — otherwise a failed read turns an unrelated edit into "this campaign
   * represents nothing", deleting every area it had.
   */
  describe('the areas this campaign represents', () => {
    const provincialCampaign = {
      id: 'c-1',
      name: 'Calgary-Elbow',
      jurisdiction: 'ca_provincial',
      office_region: 'AB',
      seat_name: 'Calgary-Elbow',
    };

    it('says nothing about the areas in an update when the stored list could not be read', async () => {
      mockCampaignsSvc.getById.mockResolvedValue(provincialCampaign);
      mockCampaignsSvc.getAreas.mockRejectedValue(new Error('network unreachable'));

      await createComponent('c-1');

      // The failure is visible, not swallowed: a toast, and the areas block says so on the page
      // instead of showing a chooser over a list it could not read.
      expect(component['areasLoadFailed']()).toBe(true);
      expect(mockAlerts.showError).toHaveBeenCalled();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Try again');
      expect(fixture.nativeElement.querySelector('#campaign-area-search')).toBeNull();

      await component['save']();

      const sent = mockCampaignsSvc.update.mock.calls[0][1];
      expect(sent).not.toHaveProperty('seat_areas');
      // Everything else about the office still saves normally.
      expect(sent.jurisdiction).toBe('ca_provincial');
      expect(sent.seat_name).toBe('Calgary-Elbow');
    });

    it('sends the emptied list when the stored areas were read and the user removed them', async () => {
      mockCampaignsSvc.getById.mockResolvedValue(provincialCampaign);
      mockCampaignsSvc.getAreas.mockResolvedValue([{ id: 'a-1', name: 'Ward 3', code: null, set_id: null }]);

      await createComponent('c-1');
      expect(component['seatAreas']()).toHaveLength(1);

      component['removeArea']('Ward 3');
      await component['save']();

      const sent = mockCampaignsSvc.update.mock.calls[0][1];
      expect(sent.seat_areas).toEqual([]);
    });

    it('asks for area suggestions when the office changes, and not on every keystroke', async () => {
      await createComponent();
      const afterFirstLoad = mockCampaignsSvc.getAreaSuggestions.mock.calls.length;

      // Signal-forms replaces the whole payload object per keystroke; typing a name must not ask.
      setOffice({ name: 'R' });
      setOffice({ name: 'Ri' });
      setOffice({ name: 'Riverdale 2026' });
      await fixture.whenStable();
      expect(mockCampaignsSvc.getAreaSuggestions.mock.calls.length).toBe(afterFirstLoad);

      // Moving the office does change which map covers it, so that asks once.
      setOffice({ jurisdiction: 'ca_provincial', office_region: 'AB' });
      await fixture.whenStable();
      expect(mockCampaignsSvc.getAreaSuggestions.mock.calls.length).toBeGreaterThan(afterFirstLoad);
    });
  });

  describe('loading an existing campaign', () => {
    it('reads every office field back into the form', async () => {
      mockCampaignsSvc.getById.mockResolvedValue({
        id: 'c-1',
        name: 'Calgary-Elbow',
        description: null,
        notes: null,
        startdate: '2026-04-01',
        enddate: '2026-05-30',
        jurisdiction: 'ca_provincial',
        office_region: 'AB',
        office_locality: null,
        chamber: null,
        seat_type: 'district',
        seat_name: 'Calgary-Elbow',
        seat_position: null,
        seat_label_override: null,
        office_title: 'MLA',
      });

      await createComponent('c-1');

      expect(component['payload']()).toMatchObject({
        jurisdiction: 'ca_provincial',
        office_region: 'AB',
        seat_name: 'Calgary-Elbow',
        office_title: 'MLA',
        chamber: '',
      });
      expect(component['seatWord']()).toBe('Constituency');
    });

    it('falls back to "other" for a jurisdiction this build does not recognize', async () => {
      mockCampaignsSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Legacy', jurisdiction: 'mars_planetary' });

      await createComponent('c-1');

      expect(component['payload']().jurisdiction).toBe('other');
    });
  });
});
