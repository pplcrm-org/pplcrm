import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignsService } from '../services/campaigns-service';
import { CampaignViewComponent } from './campaign-view';

/**
 * The detail page reads the office back in plain words. Two things it must never do: print a stored
 * identifier such as `ca_provincial` or `seat_name` at a person, and turn the receipting hint into a
 * selection. The regime a workspace may issue under depends on how the organization is registered,
 * which the campaign record cannot know, so the page only ever states and links.
 */
describe('CampaignViewComponent', () => {
  let component: CampaignViewComponent;
  let fixture: ComponentFixture<CampaignViewComponent>;
  let mockCampaignsSvc: { getById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockCampaignsSvc = { getById: vi.fn().mockResolvedValue({ id: 'c-1', name: 'A campaign' }) };
  });

  async function createComponent(campaign: Record<string, unknown>): Promise<void> {
    mockCampaignsSvc.getById.mockResolvedValue({ id: 'c-1', name: 'A campaign', kind: 'election', ...campaign });

    await TestBed.configureTestingModule({
      imports: [CampaignViewComponent],
      providers: [
        { provide: CampaignsService, useValue: mockCampaignsSvc },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: {} },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
        {
          provide: CampaignContextService,
          useValue: { activeCampaignId: () => null, campaigns: () => [], refresh: vi.fn(), setActive: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CampaignViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('offers to set the office rather than warning about it when none is recorded', async () => {
    await createComponent({ jurisdiction: 'other' });

    expect(component['hasOffice']()).toBe(false);
    expect(component['receiptHint']()).toBeNull();
  });

  it('states what a Canadian federal campaign is contesting, in its own word', async () => {
    await createComponent({ jurisdiction: 'ca_federal', seat_name: 'Ottawa Centre', office_title: 'MP' });

    expect(component['hasOffice']()).toBe(true);
    expect(component['seatWord']()).toBe('Riding');
    expect(component['officeSummary']()).toBe('MP for the riding of Ottawa Centre.');
    expect(component['spec']().label).toBe('Canada — federal');
  });

  it('uses the province’s own word and names the place', async () => {
    await createComponent({ jurisdiction: 'ca_provincial', office_region: 'AB', seat_name: 'Calgary-Elbow' });

    expect(component['seatWord']()).toBe('Constituency');
    expect(component['regionName']()).toBe('Alberta');
    expect(component['officePlace']()).toBe('Alberta');
    expect(component['officeSummary']()).toBe('Contesting the constituency of Calgary-Elbow.');
  });

  it('explains an at-large seat instead of leaving the phrase bare', async () => {
    await createComponent({
      jurisdiction: 'us_federal',
      office_region: 'OH',
      seat_type: 'at_large',
      office_title: 'Senator',
    });

    expect(component['isAtLarge']()).toBe(true);
    expect(component['officeSummary']()).toBe(
      'Senator, elected at large across Ohio. There is no congressional district for this seat.',
    );
  });

  it('names the chamber for a US state race', async () => {
    await createComponent({ jurisdiction: 'us_state', office_region: 'AZ', chamber: 'lower', seat_name: 'LD-12' });

    expect(component['chamberLabel']()).toBe('Lower chamber (state house or assembly)');
    expect(component['officeSummary']()).toBe('Contesting the legislative district of LD-12.');
  });

  it('suggests a receipting regime for a Canadian office without selecting one', async () => {
    await createComponent({ jurisdiction: 'ca_provincial', office_region: 'ON', seat_name: 'Toronto Centre' });

    const hint = component['receiptHint']();
    expect(hint?.kind).toBe('suggested');
    expect(component['suggestedRegimeLabel']().length).toBeGreaterThan(0);
    expect(hint?.message).toContain('nothing has been selected for you');
  });

  it('says plainly that US political contributions are not receipted', async () => {
    await createComponent({ jurisdiction: 'us_federal', office_region: 'OH', seat_name: 'OH-3' });

    const hint = component['receiptHint']();
    expect(hint?.kind).toBe('not_receipted');
    expect(hint?.message).toContain('not');
    expect(component['suggestedRegimeLabel']()).toBe('');
  });

  it('says nothing about receipting where there is nothing honest to say', async () => {
    await createComponent({ jurisdiction: 'ca_provincial', office_region: 'MB', seat_name: 'Fort Rouge' });

    expect(component['receiptHint']()).toBeNull();
  });
});
