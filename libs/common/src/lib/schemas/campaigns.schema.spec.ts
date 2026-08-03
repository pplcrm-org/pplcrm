import { describe, expect, it } from 'vitest';
import { AddCampaignObj, UpdateCampaignObj } from './campaigns.schema';

/** The fields that are not part of the office block, so every case below reads as office-only. */
const BASE = { name: 'Test campaign' } as const;

function addIssues(input: Record<string, unknown>): { paths: string[]; messages: string[] } {
  const result = AddCampaignObj.safeParse({ ...BASE, ...input });
  if (result.success) return { paths: [], messages: [] };
  return {
    paths: result.error.issues.map((i) => i.path.join('.')),
    messages: result.error.issues.map((i) => i.message),
  };
}

function updateIssues(input: Record<string, unknown>): string[] {
  const result = UpdateCampaignObj.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('campaign office defaults', () => {
  it('defaults an unanswered campaign to an unmodelled race with a district seat', () => {
    const parsed = AddCampaignObj.parse({ ...BASE });
    expect(parsed.jurisdiction).toBe('other');
    expect(parsed.seat_type).toBe('district');
  });

  it('does not demand a seat name for an unmodelled race', () => {
    // 'other' covers school boards, band councils and every pre-existing campaign. The product
    // does not know enough about the body to insist the seat has a name.
    expect(addIssues({ jurisdiction: 'other' }).paths).toEqual([]);
  });
});

describe('seat name', () => {
  it('is required for a district seat in every modelled jurisdiction', () => {
    expect(addIssues({ jurisdiction: 'ca_federal', seat_type: 'district' }).paths).toEqual(['seat_name']);
    expect(addIssues({ jurisdiction: 'us_federal', office_region: 'OH', seat_type: 'district' }).paths).toContain(
      'seat_name',
    );
  });

  it('names the jurisdiction word in the message, not the field name', () => {
    expect(addIssues({ jurisdiction: 'ca_federal' }).messages).toEqual([
      'Name the riding this campaign is contesting.',
    ]);
    expect(addIssues({ jurisdiction: 'ca_provincial', office_region: 'AB' }).messages).toEqual([
      'Name the constituency this campaign is contesting.',
    ]);
    expect(addIssues({ jurisdiction: 'us_federal', office_region: 'OH' }).messages).toEqual([
      'Name the congressional district this campaign is contesting.',
    ]);
  });

  it('is rejected on an at-large seat, which has no district of its own', () => {
    const issues = addIssues({
      jurisdiction: 'us_federal',
      office_region: 'OH',
      seat_type: 'at_large',
      seat_name: 'OH-3',
    });
    expect(issues.paths).toEqual(['seat_name']);
    expect(issues.messages[0]).toContain('at-large seat covers the whole area');
  });

  it('accepts an at-large seat with no seat name', () => {
    expect(
      addIssues({ jurisdiction: 'us_federal', office_region: 'OH', seat_type: 'at_large', office_title: 'Senator' })
        .paths,
    ).toEqual([]);
  });
});

describe('at-large availability', () => {
  it('is refused for Canadian federal and provincial seats, which have no at-large seats', () => {
    expect(addIssues({ jurisdiction: 'ca_federal', seat_type: 'at_large' }).paths).toEqual(['seat_type']);
    expect(addIssues({ jurisdiction: 'ca_provincial', office_region: 'ON', seat_type: 'at_large' }).paths).toEqual([
      'seat_type',
    ]);
  });

  it('is allowed for a mayor, an at-large council seat and a statewide office', () => {
    expect(
      addIssues({
        jurisdiction: 'ca_municipal',
        office_region: 'BC',
        office_locality: 'Vancouver',
        seat_type: 'at_large',
      }).paths,
    ).toEqual([]);
    expect(
      addIssues({ jurisdiction: 'us_local', office_region: 'OH', office_locality: 'Columbus', seat_type: 'at_large' })
        .paths,
    ).toEqual([]);
    // A statewide office (governor, attorney general) sits in no chamber, so none is demanded.
    expect(
      addIssues({ jurisdiction: 'us_state', office_region: 'AZ', chamber: null, seat_type: 'at_large' }).paths,
    ).toEqual([]);
  });
});

describe('chamber', () => {
  it('is required for a district seat in a US state legislature, because the two houses use different maps', () => {
    const issues = addIssues({ jurisdiction: 'us_state', office_region: 'AZ', seat_name: 'LD-12' });
    expect(issues.paths).toEqual(['chamber']);
    expect(issues.messages[0]).toContain('different maps');
  });

  it('is refused on a statewide office, which sits in no chamber', () => {
    // The false chamber would otherwise feed boundary-set selection a district map the office
    // does not have.
    const issues = addIssues({
      jurisdiction: 'us_state',
      office_region: 'AZ',
      seat_type: 'at_large',
      chamber: 'lower',
    });
    expect(issues.paths).toEqual(['chamber']);
    expect(issues.messages[0]).toContain('sits in no chamber');
  });

  it('is rejected everywhere else, including US federal where Congress has two chambers', () => {
    expect(
      addIssues({ jurisdiction: 'us_federal', office_region: 'OH', seat_name: 'OH-3', chamber: 'lower' }).paths,
    ).toEqual(['chamber']);
    expect(addIssues({ jurisdiction: 'ca_federal', seat_name: 'Ottawa Centre', chamber: 'upper' }).paths).toEqual([
      'chamber',
    ]);
  });
});

describe('office region', () => {
  it('is required wherever the seat name only makes sense with it', () => {
    expect(addIssues({ jurisdiction: 'ca_provincial', seat_name: 'Calgary-Elbow' }).paths).toEqual(['office_region']);
    expect(addIssues({ jurisdiction: 'us_federal', seat_name: 'OH-3' }).paths).toEqual(['office_region']);
    expect(addIssues({ jurisdiction: 'us_state', chamber: 'lower', seat_name: 'LD-12' }).paths).toEqual([
      'office_region',
    ]);
  });

  it('is not required for a Canadian federal riding or an unmodelled race', () => {
    expect(addIssues({ jurisdiction: 'ca_federal', seat_name: 'Ottawa Centre' }).paths).toEqual([]);
    expect(addIssues({ jurisdiction: 'other' }).paths).toEqual([]);
  });

  it('says so plainly when the code is not a region of that country', () => {
    const issues = addIssues({ jurisdiction: 'us_federal', office_region: 'ON', seat_name: 'OH-3' });
    expect(issues.paths).toEqual(['office_region']);
    expect(issues.messages[0]).toBe('We do not recognize "ON". Pick a state from the list.');
    expect(addIssues({ jurisdiction: 'ca_provincial', office_region: 'OH', seat_name: 'X' }).messages[0]).toBe(
      'We do not recognize "OH". Pick a province or territory from the list.',
    );
  });

  it('treats an unselected picker (empty string) as unanswered, not as a bad code', () => {
    const issues = addIssues({ jurisdiction: 'us_federal', office_region: '', seat_name: 'OH-3' });
    expect(issues.messages).toEqual(['Choose the state this campaign runs in.']);
  });
});

describe('office locality', () => {
  it('is required for the two local jurisdictions', () => {
    expect(addIssues({ jurisdiction: 'ca_municipal', office_region: 'ON', seat_name: 'Ward 14' }).paths).toEqual([
      'office_locality',
    ]);
    expect(addIssues({ jurisdiction: 'us_local', office_region: 'MA', seat_name: 'District 5' }).paths).toEqual([
      'office_locality',
    ]);
  });

  it('is not required above the local level', () => {
    expect(addIssues({ jurisdiction: 'ca_federal', seat_name: 'Ottawa Centre' }).paths).toEqual([]);
  });
});

/** The worked examples from the design plan, each parsed end to end. */
describe('worked examples', () => {
  const examples: Record<string, Record<string, unknown>> = {
    'Ottawa MP': { jurisdiction: 'ca_federal', seat_name: 'Ottawa Centre', office_title: 'MP' },
    'Alberta MLA': {
      jurisdiction: 'ca_provincial',
      office_region: 'AB',
      seat_name: 'Calgary-Elbow',
      seat_label_override: 'Constituency',
      office_title: 'MLA',
    },
    'Toronto councillor': {
      jurisdiction: 'ca_municipal',
      office_region: 'ON',
      office_locality: 'Toronto',
      seat_name: 'Ward 14',
      office_title: 'Councillor',
    },
    'Ohio US Representative': {
      jurisdiction: 'us_federal',
      office_region: 'OH',
      seat_name: 'OH-3',
      office_title: 'Representative',
    },
    'Arizona state representative': {
      jurisdiction: 'us_state',
      office_region: 'AZ',
      chamber: 'lower',
      seat_name: 'LD-12',
      seat_position: 'Position 2',
      office_title: 'State Representative',
    },
    'Ohio US Senator': {
      jurisdiction: 'us_federal',
      office_region: 'OH',
      seat_type: 'at_large',
      office_title: 'Senator',
    },
    // The statewide us_state office the chamber rule used to block: no district, no chamber.
    'Arizona governor': {
      jurisdiction: 'us_state',
      office_region: 'AZ',
      seat_type: 'at_large',
      office_title: 'Governor',
    },
    'Boston city councillor': {
      jurisdiction: 'us_local',
      office_region: 'MA',
      office_locality: 'Boston',
      seat_name: 'District 3',
      office_title: 'Council Member',
    },
  };

  for (const [name, office] of Object.entries(examples)) {
    it(`accepts the ${name} campaign`, () => {
      expect(addIssues(office).messages).toEqual([]);
    });
  }
});

describe('updating a campaign', () => {
  it('skips every office rule when the edit does not touch the jurisdiction', () => {
    expect(updateIssues({ name: 'Renamed' })).toEqual([]);
    expect(updateIssues({ startdate: '2026-10-19' })).toEqual([]);
  });

  it('applies every office rule once the edit states a jurisdiction', () => {
    expect(updateIssues({ jurisdiction: 'us_state', office_region: 'AZ', seat_type: 'district' })).toEqual([
      'seat_name',
      'chamber',
    ]);
    expect(
      updateIssues({
        jurisdiction: 'us_state',
        office_region: 'AZ',
        chamber: 'upper',
        seat_type: 'district',
        seat_name: 'LD-12',
      }),
    ).toEqual([]);
  });

  it('does not assume a seat type the edit did not send', () => {
    // An at-large campaign being renamed must not be told to name a district it never had.
    expect(updateIssues({ jurisdiction: 'ca_federal' })).toEqual([]);
    // Nor to choose a chamber for a district seat the edit never claimed.
    expect(updateIssues({ jurisdiction: 'us_state', office_region: 'AZ' })).toEqual([]);
  });

  it('still rejects a date that is not a plain calendar date', () => {
    expect(updateIssues({ startdate: '19-10-2026' })).toEqual(['startdate']);
  });
});
