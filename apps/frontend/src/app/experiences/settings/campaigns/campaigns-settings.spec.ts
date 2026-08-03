import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { CampaignsService } from '../../campaigns/services/campaigns-service';
import { CampaignsSettingsComponent } from './campaigns-settings';

/**
 * A workspace can run several campaigns at once, at completely different levels of government. The
 * card list has to make them tellable apart at a glance, in each campaign's own words rather than
 * in the stored identifiers.
 */
describe('CampaignsSettingsComponent', () => {
  let component: CampaignsSettingsComponent;
  let fixture: ComponentFixture<CampaignsSettingsComponent>;

  /** A switcher-list row with only the fields the office line reads. */
  function row(overrides: Record<string, unknown>) {
    return {
      id: 'c1',
      name: 'A campaign',
      kind: 'election',
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

  /** The component's own officeLine, reached through the same loose row shape the API returns. */
  function officeLine(overrides: Record<string, unknown>): string {
    const line: unknown = component['officeLine'](row(overrides));
    return typeof line === 'string' ? line : '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsSettingsComponent],
      providers: [
        provideRouter([]),
        { provide: CampaignsService, useValue: { getSwitcherList: vi.fn().mockResolvedValue([]) } },
        {
          provide: CampaignContextService,
          useValue: { ensureLoaded: vi.fn().mockResolvedValue(undefined), activeCampaignId: () => null },
        },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CampaignsSettingsComponent);
    component = fixture.componentInstance;
  });

  it('says nothing at all when no office has been recorded', () => {
    expect(officeLine({})).toBe('');
  });

  it('names a Canadian federal riding', () => {
    expect(officeLine({ jurisdiction: 'ca_federal', seat_name: 'Ottawa Centre', office_title: 'MP' })).toBe(
      'Canada — federal · Riding: Ottawa Centre · MP',
    );
  });

  it("uses Alberta's own word without anyone configuring it", () => {
    expect(officeLine({ jurisdiction: 'ca_provincial', office_region: 'AB', seat_name: 'Calgary-Elbow' })).toBe(
      'Canada — provincial or territorial · Alberta · Constituency: Calgary-Elbow',
    );
  });

  it('names the municipality for a local race', () => {
    expect(
      officeLine({
        jurisdiction: 'ca_municipal',
        office_region: 'ON',
        office_locality: 'Toronto',
        seat_name: 'Ward 14',
        office_title: 'Councillor',
      }),
    ).toBe('Canada — municipal · Toronto · Ontario · Ward: Ward 14 · Councillor');
  });

  it('shows the chamber and the seat position for a US state race', () => {
    expect(
      officeLine({
        jurisdiction: 'us_state',
        office_region: 'AZ',
        chamber: 'lower',
        seat_name: 'LD-12',
        seat_position: 'Position 2',
      }),
    ).toBe('United States — state · Arizona · Lower chamber · Legislative district: LD-12 · Position 2');
  });

  it('says "At large" instead of a district that does not exist', () => {
    expect(
      officeLine({ jurisdiction: 'us_federal', office_region: 'OH', seat_type: 'at_large', office_title: 'Senator' }),
    ).toBe('United States — federal · Ohio · At large · Senator');
  });

  it("follows the campaign's own word for the area when one is set", () => {
    expect(officeLine({ jurisdiction: 'other', seat_name: 'Zone 3', seat_label_override: 'Trustee area' })).toBe(
      'Trustee area: Zone 3',
    );
  });

  it('still tells office from election', () => {
    expect(component['kindLabel']('office')).toBe('Office');
    expect(component['kindLabel']('election')).toBe('Election');
  });
});
