import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { HouseholdsService } from '@experiences/households/services/households-service';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { TagsService } from '@experiences/tags/services/tags-service';

import { ListForm } from '../ui/list-form';
import { ListsService } from './lists-service';
import { ListsRefreshService } from './lists-refresh.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { describeListDefinition } from './list-definition';
import {
  ANY_ELECTORAL_AREA_FIELD,
  ELECTORAL_AREA_FIELD,
  RULE_FIELD_LABELS,
  ruleFieldLabel,
  ruleOpUsesSetWording,
} from './list-rule-fields';

/**
 * The rule builder drops any rule whose field the backend cannot map, silently, so the two
 * electoral fields have to stay spelled exactly as the backend's column mapping spells them
 * (`households.repo.ts` and `persons.repo.ts`). These assertions are the tripwire for a rename.
 */
describe('electoral rule fields', () => {
  it('uses the exact field names the backend column mapping resolves', () => {
    expect(ELECTORAL_AREA_FIELD).toBe('electoral_area');
    expect(ANY_ELECTORAL_AREA_FIELD).toBe('any_electoral_area');
  });

  it('offers neutral labels when no campaign jurisdiction is declared', () => {
    expect(RULE_FIELD_LABELS[ELECTORAL_AREA_FIELD]).toBe('Electoral area');
    expect(ruleFieldLabel(ELECTORAL_AREA_FIELD)).toBe('Electoral area');
    expect(ruleFieldLabel(ANY_ELECTORAL_AREA_FIELD)).toBe('Any electoral boundary');
  });

  it("names the single-valued field with the campaign's own word", () => {
    expect(ruleFieldLabel(ELECTORAL_AREA_FIELD, 'Riding')).toBe('Riding');
    expect(ruleFieldLabel(ELECTORAL_AREA_FIELD, 'Congressional district')).toBe('Congressional district');
  });

  it('never applies the campaign word to the all-levels field', () => {
    // It spans a federal riding, a city ward and a precinct at the same time, so no single word
    // is true of it.
    expect(ruleFieldLabel(ANY_ELECTORAL_AREA_FIELD, 'Riding')).toBe('Any electoral boundary');
  });

  it('reads an absent boundary as "not set" rather than "empty"', () => {
    expect(ruleOpUsesSetWording(ELECTORAL_AREA_FIELD)).toBe(true);
    expect(ruleOpUsesSetWording(ANY_ELECTORAL_AREA_FIELD)).toBe(true);
    // A free-text field genuinely can be an empty string, so it keeps the original wording.
    expect(ruleOpUsesSetWording('city')).toBe(false);
  });
});

describe('the saved definition sentence', () => {
  const definitionWith = (field: string, op: string, value: string) => ({
    advancedFilterModel: {
      kind: 'group',
      id: 'root',
      conjunction: 'AND',
      rules: [{ kind: 'rule', id: 'r1', field, op, value }],
    },
  });

  it("describes an electoral rule in the campaign's own word", () => {
    const sentence = describeListDefinition(definitionWith(ELECTORAL_AREA_FIELD, 'equals', 'Ward 4'), 'Ward');
    expect(sentence).toBe("Ward equals 'Ward 4'");
  });

  it('falls back to neutral wording when no campaign word is supplied', () => {
    const sentence = describeListDefinition(definitionWith(ELECTORAL_AREA_FIELD, 'equals', 'Ward 4'));
    expect(sentence).toBe("Electoral area equals 'Ward 4'");
  });

  it('describes an all-levels rule as a contains test', () => {
    const sentence = describeListDefinition(
      definitionWith(ANY_ELECTORAL_AREA_FIELD, 'contains', 'Precinct 12'),
      'Ward',
    );
    expect(sentence).toBe("Any electoral boundary contains 'Precinct 12'");
  });

  it('says "is not set" for an absent boundary', () => {
    const sentence = describeListDefinition(definitionWith(ELECTORAL_AREA_FIELD, 'isEmpty', ''), 'Ward');
    expect(sentence).toBe('Ward is not set');
  });
});

/**
 * Field parity with the backend column mapping — the tripwire for EVERY rule field.
 *
 * `BaseRepository.buildGroupExpression` (apps/backend/src/app/lib/base.repo.ts) silently drops
 * any rule whose field is not a key of the repo's `columnMapping`: no error, no warning, the
 * list just matches more people than the UI promised. So every field the rule builder offers
 * must be a mapped key on the backend.
 *
 * The frontend cannot import the backend repos (project boundary), so the two sets below are
 * hand-copied from the `columnMapping` objects in:
 *   - apps/backend/src/app/modules/persons/repositories/persons.repo.ts   (getAllWithAddress)
 *   - apps/backend/src/app/modules/households/repositories/households.repo.ts
 *
 * If this test fails, one of two things happened:
 *   1. A field was added to `listFields` in list-form.ts without a backend mapping — add the
 *      mapping first (see the pplcrm-lists skill checklist), then add the key here.
 *   2. A key was renamed on either side — rename it on BOTH sides plus here.
 * Never fix a failure by only editing these arrays: they must mirror the backend file.
 */
const PERSONS_COLUMN_MAPPING_KEYS = [
  'first_name',
  'last_name',
  'email',
  'mobile',
  'city',
  'state',
  'street1',
  'street_num',
  'zip',
  'tag',
  'tags',
  'issues',
  'company_name',
  'notes',
  'country',
  'volunteer_status',
  'staff_status',
  'senior',
  'deceased',
  'subscription_status',
  'support_level',
  'voting_status',
  'do_not_contact',
  // Mapped only while the electoral lateral join is present, but the join is always part of
  // getAllWithAddress when boundary data exists — see electoralAreaSelects.
  'electoral_area',
  'any_electoral_area',
];

const HOUSEHOLDS_COLUMN_MAPPING_KEYS = [
  'city',
  'state',
  'street1',
  'street2',
  'street_num',
  'zip',
  'country',
  'home_phone',
  'tag',
  'tags',
  'issues',
  'electoral_area',
  'any_electoral_area',
];

describe('rule-builder field parity with the backend columnMapping', () => {
  beforeEach(async () => {
    const emptyResult = { rows: [], count: 0 };
    await TestBed.configureTestingModule({
      imports: [ListForm],
      providers: [
        provideRouter([]),
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
        {
          provide: PersonsService,
          useValue: { count: vi.fn().mockResolvedValue(0), getAll: vi.fn().mockResolvedValue(emptyResult) },
        },
        {
          provide: HouseholdsService,
          useValue: { count: vi.fn().mockResolvedValue(0), getAll: vi.fn().mockResolvedValue(emptyResult) },
        },
        { provide: ListsService, useValue: { getById: vi.fn() } },
        { provide: ListsRefreshService, useValue: {} },
        { provide: TagsService, useValue: {} },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(), choose: vi.fn() } },
        {
          provide: CampaignContextService,
          useValue: { ensureLoaded: vi.fn().mockResolvedValue(undefined), seatLabel: () => 'Ward' },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null }, data: {} } } },
      ],
    }).compileComponents();
  });

  /** The real field list the picker offers, straight from the component. */
  function fieldNames(object: 'people' | 'households'): string[] {
    const fixture = TestBed.createComponent(ListForm);
    const component = fixture.componentInstance as any;
    component.payload.update((p: Record<string, unknown>) => ({ ...p, object }));
    return component.listFields().map((f: { name: string }) => f.name);
  }

  it('every people rule field is a key the persons columnMapping resolves', () => {
    const names = fieldNames('people');
    // Sanity: the walk found the real list, not an empty stub.
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names).toContain(ELECTORAL_AREA_FIELD);
    expect(names).toContain(ANY_ELECTORAL_AREA_FIELD);

    const mapped = new Set(PERSONS_COLUMN_MAPPING_KEYS);
    const unmapped = names.filter((name) => !mapped.has(name));
    // A field named here would be silently dropped by the backend — see the comment above.
    expect(unmapped).toEqual([]);
  });

  it('every household rule field is a key the households columnMapping resolves', () => {
    const names = fieldNames('households');
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toContain(ELECTORAL_AREA_FIELD);
    expect(names).toContain(ANY_ELECTORAL_AREA_FIELD);

    const mapped = new Set(HOUSEHOLDS_COLUMN_MAPPING_KEYS);
    const unmapped = names.filter((name) => !mapped.has(name));
    expect(unmapped).toEqual([]);
  });

  it('no rule field is offered twice', () => {
    for (const object of ['people', 'households'] as const) {
      const names = fieldNames(object);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
