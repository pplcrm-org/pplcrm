import { describe, expect, it } from 'vitest';

import type { CompanionHousehold, CompanionOpType, CompanionPerson, CompanionSurveyPrefill } from '@common';

import {
  applyLocalOps,
  conversations,
  deriveSegments,
  doorStatus,
  doorStatusLabel,
  isAttempted,
  isTempPersonId,
  meStats,
  nextDoor,
  opPersonId,
  segmentKeyOf,
  supportConsensus,
  UNKNOWN_SEGMENT_KEY,
} from './canvass-derive';

function prefill(overrides: Partial<CompanionSurveyPrefill> = {}): CompanionSurveyPrefill {
  return {
    support: 'supporter',
    issues: [],
    wants_volunteer: false,
    wants_yard_sign: false,
    set_dnc: false,
    subscribe: false,
    ...overrides,
  };
}

function person(overrides: Partial<CompanionPerson> = {}): CompanionPerson {
  return { id: '1', name: 'Alice Door', dnc: false, result: null, survey: null, ...overrides };
}

function household(overrides: Partial<CompanionHousehold> = {}): CompanionHousehold {
  return {
    id: '10',
    walk_order: 1,
    address: '218 Alder St',
    street: 'Alder St',
    street_num: '218',
    lat: null,
    lng: null,
    dnc: false,
    door_outcome: null,
    hh_survey: null,
    people: [],
    ...overrides,
  };
}

describe('doorStatus', () => {
  it('returns dnc for a do-not-contact door, even when surveyed', () => {
    expect(doorStatus(household({ dnc: true }))).toBe('dnc');
    expect(doorStatus(household({ dnc: true, hh_survey: prefill() }))).toBe('dnc');
  });

  it('returns the door outcome when one is set, beating survey state', () => {
    expect(doorStatus(household({ door_outcome: 'no_answer' }))).toBe('outcome:no_answer');
    expect(doorStatus(household({ door_outcome: 'inaccessible' }))).toBe('outcome:inaccessible');
    expect(doorStatus(household({ door_outcome: 'refused', hh_survey: prefill() }))).toBe('outcome:refused');
  });

  it('is canvassed when the household survey exists', () => {
    expect(doorStatus(household({ hh_survey: prefill() }))).toBe('canvassed');
  });

  it('is canvassed when every person has a result', () => {
    const h = household({
      people: [person({ id: '1', result: 'canvassed' }), person({ id: '2', result: 'not_home' })],
    });
    expect(doorStatus(h)).toBe('canvassed');
  });

  it('is not canvassed for a no-people door without a household survey', () => {
    expect(doorStatus(household({ people: [] }))).toBe('not_visited');
  });

  it('is in_progress when only some people have results', () => {
    const h = household({ people: [person({ id: '1', result: 'canvassed' }), person({ id: '2' })] });
    expect(doorStatus(h)).toBe('in_progress');
  });

  it('is not_visited when nothing was recorded', () => {
    expect(doorStatus(household({ people: [person()] }))).toBe('not_visited');
  });
});

describe('doorStatusLabel', () => {
  it('labels every status in sentence case', () => {
    expect(doorStatusLabel('dnc')).toBe('Do not contact');
    expect(doorStatusLabel('outcome:no_answer')).toBe('No answer');
    expect(doorStatusLabel('outcome:inaccessible')).toBe('Inaccessible');
    expect(doorStatusLabel('outcome:refused')).toBe('Refused');
    expect(doorStatusLabel('canvassed')).toBe('Canvassed');
    expect(doorStatusLabel('in_progress')).toBe('In progress');
    expect(doorStatusLabel('not_visited')).toBe('Not visited');
  });
});

describe('isAttempted', () => {
  it('counts canvassed, outcome, and dnc doors', () => {
    expect(isAttempted(household({ hh_survey: prefill() }))).toBe(true);
    expect(isAttempted(household({ door_outcome: 'no_answer' }))).toBe(true);
    expect(isAttempted(household({ dnc: true }))).toBe(true);
  });

  it('does not count not-visited or in-progress doors', () => {
    expect(isAttempted(household())).toBe(false);
    const inProgress = household({ people: [person({ id: '1', result: 'refused' }), person({ id: '2' })] });
    expect(isAttempted(inProgress)).toBe(false);
  });
});

describe('nextDoor', () => {
  it('returns the lowest walk_order door not yet attempted', () => {
    const doors = [
      household({ id: 'a', walk_order: 3 }),
      household({ id: 'b', walk_order: 1, hh_survey: prefill() }),
      household({ id: 'c', walk_order: 2 }),
    ];
    expect(nextDoor(doors)?.id).toBe('c');
  });

  it('returns null when every door is attempted', () => {
    expect(nextDoor([household({ dnc: true }), household({ id: '11', door_outcome: 'refused' })])).toBeNull();
  });
});

describe('conversations', () => {
  it('counts surveyed people plus household-level surveys', () => {
    const doors = [
      household({
        id: 'a',
        hh_survey: prefill(),
        people: [person({ id: '1', result: 'canvassed', survey: prefill() })],
      }),
      household({ id: 'b', people: [person({ id: '2', result: 'not_home' })] }),
    ];
    expect(conversations(doors)).toBe(2);
  });

  it('is zero for an untouched turf', () => {
    expect(conversations([household()])).toBe(0);
  });
});

describe('supportConsensus', () => {
  it('returns the shared level when all surveyed voices agree', () => {
    const h = household({
      hh_survey: prefill({ support: 'undecided' }),
      people: [person({ id: '1', result: 'canvassed', survey: prefill({ support: 'undecided' }) })],
    });
    expect(supportConsensus(h)).toBe('undecided');
  });

  it('returns mixed when voices disagree', () => {
    const h = household({
      people: [
        person({ id: '1', result: 'canvassed', survey: prefill({ support: 'supporter' }) }),
        person({ id: '2', result: 'canvassed', survey: prefill({ support: 'non_supporter' }) }),
      ],
    });
    expect(supportConsensus(h)).toBe('mixed');
  });

  it('returns null when no stance was recorded', () => {
    expect(supportConsensus(household())).toBeNull();
    // A DNC-only save carries no support level and casts no voice.
    const dncOnly = household({
      people: [person({ id: '1', result: 'canvassed', survey: prefill({ support: null, set_dnc: true }) })],
    });
    expect(supportConsensus(dncOnly)).toBeNull();
  });

  it('uses the household survey as a voice for a no-name door', () => {
    expect(supportConsensus(household({ hh_survey: prefill({ support: 'supporter' }) }))).toBe('supporter');
  });
});

describe('meStats', () => {
  it('derives doors, conversations, supporters, and contact rate', () => {
    const doors = [
      // Attempted + conversation + supporter.
      household({ id: 'a', people: [person({ id: '1', result: 'canvassed', survey: prefill() })] }),
      // Attempted, no conversation.
      household({ id: 'b', door_outcome: 'no_answer' }),
      // DNC counts as attempted.
      household({ id: 'c', dnc: true }),
      // Untouched.
      household({ id: 'd' }),
    ];
    const stats = meStats(doors);
    expect(stats.doors_total).toBe(4);
    expect(stats.doors_attempted).toBe(3);
    expect(stats.conversations).toBe(1);
    expect(stats.supporters).toBe(1);
    expect(stats.contact_rate).toBe(33); // 1 conversation door of 3 attempted
  });

  it('keeps the contact rate at zero with nothing attempted', () => {
    expect(meStats([household()]).contact_rate).toBe(0);
  });

  it('ranks top issues by mentions, then alphabetically', () => {
    const doors = [
      household({
        id: 'a',
        hh_survey: prefill({ issues: ['Roads', 'Housing'] }),
        people: [person({ id: '1', result: 'canvassed', survey: prefill({ issues: ['Housing'] }) })],
      }),
      household({
        id: 'b',
        people: [person({ id: '2', result: 'canvassed', survey: prefill({ issues: ['Parks'] }) })],
      }),
    ];
    expect(meStats(doors).top_issues).toEqual([
      { issue: 'Housing', count: 2 },
      { issue: 'Parks', count: 1 },
      { issue: 'Roads', count: 1 },
    ]);
  });
});

describe('opPersonId / isTempPersonId', () => {
  it('extracts the person id only from ops that carry one', () => {
    const survey: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'survey',
      payload: {
        household_id: '10',
        person_id: '7',
        support: 'supporter',
        issues: [],
        wants_volunteer: false,
        wants_yard_sign: false,
        set_dnc: false,
        subscribe: false,
      },
    };
    expect(opPersonId(survey)).toBe('7');
    expect(
      opPersonId({ op_id: 'op-2', recorded_at: null, type: 'clear_outcome', payload: { household_id: '10' } }),
    ).toBeNull();
    expect(
      opPersonId({
        op_id: 'op-3',
        recorded_at: null,
        type: 'person_result',
        payload: { household_id: '10', person_id: '9', result: 'moved' },
      }),
    ).toBe('9');
  });

  it('recognizes temp ids', () => {
    expect(isTempPersonId('tmp-abc')).toBe(true);
    expect(isTempPersonId('123')).toBe(false);
  });
});

describe('applyLocalOps', () => {
  const base = (): CompanionHousehold[] => [household({ id: '10', people: [person({ id: '1' })] })];

  it('marks a person canvassed with a survey prefill', () => {
    const op: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'survey',
      payload: {
        household_id: '10',
        person_id: '1',
        support: 'undecided',
        issues: ['Roads'],
        wants_volunteer: true,
        wants_yard_sign: false,
        set_dnc: false,
        subscribe: false,
      },
    };
    const [h] = applyLocalOps(base(), [{ op }]);
    expect(h.people[0].result).toBe('canvassed');
    expect(h.people[0].survey).toEqual({
      support: 'undecided',
      issues: ['Roads'],
      wants_volunteer: true,
      wants_yard_sign: false,
      set_dnc: false,
      subscribe: false,
    });
  });

  it('records a household-level survey when person_id is null', () => {
    const op: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'survey',
      payload: {
        household_id: '10',
        person_id: null,
        support: 'supporter',
        issues: [],
        wants_volunteer: false,
        wants_yard_sign: true,
        set_dnc: false,
        subscribe: false,
      },
    };
    const [h] = applyLocalOps(base(), [{ op }]);
    expect(h.hh_survey?.support).toBe('supporter');
    expect(h.hh_survey?.wants_yard_sign).toBe(true);
  });

  it('applies person results and clears a stale survey', () => {
    const seeded = [household({ id: '10', people: [person({ id: '1', result: 'canvassed', survey: prefill() })] })];
    const op: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'person_result',
      payload: { household_id: '10', person_id: '1', result: 'moved' },
    };
    const [h] = applyLocalOps(seeded, [{ op }]);
    expect(h.people[0].result).toBe('moved');
    expect(h.people[0].survey).toBeNull();
  });

  it('sets and clears door outcomes, latest op winning', () => {
    const set: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'door_outcome',
      payload: { household_id: '10', outcome: 'no_answer' },
    };
    const clear: CompanionOpType = {
      op_id: 'op-2',
      recorded_at: null,
      type: 'clear_outcome',
      payload: { household_id: '10' },
    };
    expect(applyLocalOps(base(), [{ op: set }])[0].door_outcome).toBe('no_answer');
    expect(applyLocalOps(base(), [{ op: set }, { op: clear }])[0].door_outcome).toBeNull();
  });

  it('adds a person under their temp id, once', () => {
    const op: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'person_create',
      payload: { household_id: '10', name: 'New Neighbor' },
    };
    const ops = [{ op, temp_person_id: 'tmp-op-1' }];
    const [h] = applyLocalOps(base(), ops);
    expect(h.people.map((p) => p.id)).toEqual(['1', 'tmp-op-1']);
    expect(h.people[1].name).toBe('New Neighbor');
    // Replaying is idempotent.
    expect(applyLocalOps([h], ops)[0].people).toHaveLength(2);
  });

  it('ignores ops for households outside the payload and never mutates its input', () => {
    const input = base();
    const op: CompanionOpType = {
      op_id: 'op-1',
      recorded_at: null,
      type: 'door_outcome',
      payload: { household_id: '999', outcome: 'refused' },
    };
    const sameSet: CompanionOpType = {
      op_id: 'op-2',
      recorded_at: null,
      type: 'door_outcome',
      payload: { household_id: '10', outcome: 'refused' },
    };
    const out = applyLocalOps(input, [{ op }, { op: sameSet }]);
    expect(out[0].door_outcome).toBe('refused');
    expect(input[0].door_outcome).toBeNull();
  });
});

describe('deriveSegments', () => {
  it("groups doors by street and reports each street's own progress", () => {
    const segments = deriveSegments([
      household({ id: '1', walk_order: 1, street: 'Alder St' }),
      household({ id: '2', walk_order: 2, street: 'Alder St', door_outcome: 'no_answer' }),
      household({ id: '3', walk_order: 3, street: 'Scott Blvd' }),
    ]);
    expect(segments.map((s) => s.street)).toEqual(['Alder St', 'Scott Blvd']);
    expect(segments[0]).toMatchObject({ doors: 2, attempted: 1, minWalkOrder: 1 });
    expect(segments[1]).toMatchObject({ doors: 1, attempted: 0, minWalkOrder: 3 });
  });

  it('treats spelling and spacing differences as one street but shows the first spelling', () => {
    const segments = deriveSegments([
      household({ id: '1', walk_order: 1, street: 'Alder St' }),
      household({ id: '2', walk_order: 2, street: '  alder   st ' }),
    ]);
    expect(segments).toHaveLength(1);
    // Normalizing the key is fine; normalizing what the volunteer reads would not be.
    expect(segments[0]?.street).toBe('Alder St');
    expect(segments[0]?.doors).toBe(2);
  });

  it('puts every door with no street into one bucket, not one bucket each', () => {
    const segments = deriveSegments([
      household({ id: '1', walk_order: 1, street: null }),
      household({ id: '2', walk_order: 2, street: '   ' }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ key: UNKNOWN_SEGMENT_KEY, street: 'No street on file', doors: 2 });
  });

  it('sorts by walk order, not alphabetically — walk order is the only order that means anything on foot', () => {
    const segments = deriveSegments([
      household({ id: '1', walk_order: 9, street: 'Alder St' }),
      household({ id: '2', walk_order: 2, street: 'Zenith Way' }),
    ]);
    expect(segments.map((s) => s.street)).toEqual(['Zenith Way', 'Alder St']);
  });

  it('averages only the geocoded doors, and reports no centroid when none are', () => {
    const withGeo = deriveSegments([
      household({ id: '1', walk_order: 1, street: 'Alder St', lat: 10, lng: 20 }),
      household({ id: '2', walk_order: 2, street: 'Alder St', lat: 12, lng: 24 }),
      household({ id: '3', walk_order: 3, street: 'Alder St', lat: null, lng: null }),
    ]);
    expect(withGeo[0]?.centroid).toEqual({ lat: 11, lng: 22 });

    const withoutGeo = deriveSegments([household({ id: '1', walk_order: 1, street: 'Alder St' })]);
    expect(withoutGeo[0]?.centroid).toBeNull();
  });

  it('agrees with segmentKeyOf, so grouping and filtering can never diverge', () => {
    const doors = [
      household({ id: '1', walk_order: 1, street: 'Alder St' }),
      household({ id: '2', walk_order: 2, street: 'ALDER ST' }),
      household({ id: '3', walk_order: 3, street: 'Scott Blvd' }),
    ];
    const [alder] = deriveSegments(doors);
    expect(doors.filter((h) => segmentKeyOf(h) === alder?.key)).toHaveLength(2);
  });
});
