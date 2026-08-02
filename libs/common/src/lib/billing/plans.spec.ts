import { describe, it, expect } from 'vitest';
import type { GatedFeature } from './plans';
import {
  annualPriceForQuantity,
  bracketForQuantity,
  cadenceLabel,
  monthlyEquivalentUsd,
  ANNUAL_MONTHS_FREE,
  ANNUAL_PRICE_MULTIPLIER,
  bracketIndexForSubscribers,
  emailCapForQuantity,
  getPlanDef,
  maxQuantity,
  planAllowsFeature,
  planDisplayName,
  priceForQuantity,
  priceLabelAt,
  subscriberCapForQuantity,
  FEATURE_MATRIX,
  GATED_FEATURES,
  PLANS_BY_KEY,
  PURCHASABLE_PLAN_KEYS,
  startingPriceLabel,
  startingPriceUsd,
} from './plans';

describe('bracketIndexForSubscribers', () => {
  it('free: boundaries at the tier max', () => {
    expect(bracketIndexForSubscribers('free', 0)).toBe(1);
    expect(bracketIndexForSubscribers('free', 1_000)).toBe(1);
    expect(bracketIndexForSubscribers('free', 1_001)).toBeNull();
  });

  it('grassroots: bracket boundaries including the tier max', () => {
    expect(bracketIndexForSubscribers('grassroots', 0)).toBe(1);
    expect(bracketIndexForSubscribers('grassroots', 1_000)).toBe(1);
    expect(bracketIndexForSubscribers('grassroots', 1_001)).toBe(2);
    expect(bracketIndexForSubscribers('grassroots', 2_500)).toBe(2);
    expect(bracketIndexForSubscribers('grassroots', 2_501)).toBe(3);
    expect(bracketIndexForSubscribers('grassroots', 25_000)).toBe(7);
    expect(bracketIndexForSubscribers('grassroots', 25_001)).toBe(8);
    expect(bracketIndexForSubscribers('grassroots', 100_000)).toBe(10);
    expect(bracketIndexForSubscribers('grassroots', 100_001)).toBeNull();
  });

  it('movement: bracket boundaries including the piecewise step change at 25,000', () => {
    expect(bracketIndexForSubscribers('movement', 1_000)).toBe(1);
    expect(bracketIndexForSubscribers('movement', 25_000)).toBe(7);
    expect(bracketIndexForSubscribers('movement', 25_001)).toBe(8);
    expect(bracketIndexForSubscribers('movement', 200_000)).toBe(11);
    expect(bracketIndexForSubscribers('movement', 200_001)).toBeNull();
  });

  it('enterprise: has no bracket ladder, always null', () => {
    expect(bracketIndexForSubscribers('enterprise', 100)).toBeNull();
  });
});

describe('priceForQuantity', () => {
  it('grassroots spot checks, including the piecewise step change', () => {
    expect(priceForQuantity('grassroots', 1)).toBe(29);
    expect(priceForQuantity('grassroots', 2)).toBe(49);
    expect(priceForQuantity('grassroots', 7)).toBe(149); // last +$20 bracket
    expect(priceForQuantity('grassroots', 8)).toBe(219); // first +$70 bracket
    expect(priceForQuantity('grassroots', 10)).toBe(359);
  });

  it('movement spot checks, including the piecewise step change', () => {
    expect(priceForQuantity('movement', 1)).toBe(55);
    expect(priceForQuantity('movement', 7)).toBe(265); // last +$35 bracket
    expect(priceForQuantity('movement', 8)).toBe(365); // first +$100 bracket
    expect(priceForQuantity('movement', 11)).toBe(665);
  });
});

describe('annual pricing', () => {
  it('is exactly 10× monthly ("2 months free") at every bracket of both paid tiers', () => {
    expect(ANNUAL_PRICE_MULTIPLIER).toBe(12 - ANNUAL_MONTHS_FREE);
    for (const key of PURCHASABLE_PLAN_KEYS) {
      const pricing = PLANS_BY_KEY[key].pricing;
      if (!pricing) throw new Error(`expected pricing for ${key}`);
      pricing.brackets.forEach((bracket, i) => {
        expect(annualPriceForQuantity(key, i + 1)).toBe(bracket.price * 10);
      });
    }
  });

  it('annual spot checks: Grassroots $290/yr and Movement $550/yr at the first bracket', () => {
    expect(annualPriceForQuantity('grassroots', 1)).toBe(290);
    expect(annualPriceForQuantity('movement', 1)).toBe(550);
    expect(annualPriceForQuantity('movement', 11)).toBe(6_650);
  });

  it('monthlyEquivalentUsd rounds the annual total to the nearest whole dollar', () => {
    expect(monthlyEquivalentUsd(290)).toBe(24); // 24.17 → 24
    expect(monthlyEquivalentUsd(550)).toBe(46); // 45.83 → 46
    expect(monthlyEquivalentUsd(690)).toBe(58); // 57.50 → 58
    expect(monthlyEquivalentUsd(1810)).toBe(151); // 150.83 → 151
    expect(monthlyEquivalentUsd(0)).toBe(0);
  });
});

describe('cadenceLabel', () => {
  it('paid plans switch cadence with the billing interval', () => {
    expect(cadenceLabel(PLANS_BY_KEY.grassroots, 'month')).toBe('per month');
    expect(cadenceLabel(PLANS_BY_KEY.grassroots, 'year')).toBe('per month, billed annually');
    expect(cadenceLabel(PLANS_BY_KEY.movement, 'year')).toBe('per month, billed annually');
  });

  it('non-purchasable plans keep their static cadence on either interval', () => {
    expect(cadenceLabel(PLANS_BY_KEY.free, 'year')).toBe('forever');
    expect(cadenceLabel(PLANS_BY_KEY.enterprise, 'year')).toBe('contact us');
  });
});

describe('emailCapForQuantity', () => {
  it('is 8x the subscriber cap on Grassroots and 12x on Movement', () => {
    expect(emailCapForQuantity('grassroots', 1)).toBe(1_000 * 8);
    expect(emailCapForQuantity('movement', 6)).toBe(20_000 * 12);
  });

  it('is 2x the subscriber cap on free', () => {
    expect(emailCapForQuantity('free', 1)).toBe(1_000 * 2);
  });
});

describe('startingPriceLabel', () => {
  it('labels each displayed plan', () => {
    expect(startingPriceLabel(PLANS_BY_KEY.free)).toBe('$0');
    expect(startingPriceLabel(PLANS_BY_KEY.grassroots)).toBe('From $29');
    expect(startingPriceLabel(PLANS_BY_KEY.movement)).toBe('From $55');
    expect(startingPriceLabel(PLANS_BY_KEY.enterprise)).toBe('Custom');
  });

  it('shows the rounded monthly-equivalent of the annual price on the year interval', () => {
    expect(startingPriceLabel(PLANS_BY_KEY.grassroots, 'year')).toBe('From $24');
    expect(startingPriceLabel(PLANS_BY_KEY.movement, 'year')).toBe('From $46');
    expect(startingPriceLabel(PLANS_BY_KEY.free, 'year')).toBe('$0');
    expect(startingPriceLabel(PLANS_BY_KEY.enterprise, 'year')).toBe('Custom');
  });
});

describe('priceLabelAt', () => {
  it('returns the live price within the ladder', () => {
    expect(priceLabelAt(PLANS_BY_KEY.grassroots, 10_000)).toBe('$89');
    expect(priceLabelAt(PLANS_BY_KEY.movement, 100_000)).toBe('$565');
  });

  it('returns "Contact us" past the tier max', () => {
    expect(priceLabelAt(PLANS_BY_KEY.grassroots, 100_001)).toBe('Contact us');
    expect(priceLabelAt(PLANS_BY_KEY.movement, 200_001)).toBe('Contact us');
  });

  it('returns "Custom" for enterprise regardless of count', () => {
    expect(priceLabelAt(PLANS_BY_KEY.enterprise, 5)).toBe('Custom');
  });

  it('year interval shows the rounded monthly-equivalent of the annual price', () => {
    expect(priceLabelAt(PLANS_BY_KEY.grassroots, 10_000, 'year')).toBe('$74'); // $890/yr
    expect(priceLabelAt(PLANS_BY_KEY.grassroots, 5_000, 'year')).toBe('$58'); // $690/yr
    expect(priceLabelAt(PLANS_BY_KEY.movement, 100_000, 'year')).toBe('$471'); // $5,650/yr
    expect(priceLabelAt(PLANS_BY_KEY.grassroots, 100_001, 'year')).toBe('Contact us');
  });
});

describe('getPlanDef legacy alias resolution', () => {
  it('resolves the retired representative key to movement, case-insensitively', () => {
    expect(getPlanDef('Representative')?.key).toBe('movement');
    expect(getPlanDef('representative')?.key).toBe('movement');
  });

  it('resolves the renamed starter key to free, case-insensitively', () => {
    expect(getPlanDef('starter')?.key).toBe('free');
    expect(getPlanDef('STARTER')?.key).toBe('free');
  });

  it('still resolves current keys directly', () => {
    expect(getPlanDef('movement')?.key).toBe('movement');
    expect(getPlanDef('grassroots')?.key).toBe('grassroots');
  });
});

describe('planAllowsFeature', () => {
  it('gates Grassroots-tier features off the free plan', () => {
    expect(planAllowsFeature('free', 'forms')).toBe(false);
    expect(planAllowsFeature('grassroots', 'forms')).toBe(true);
    expect(planAllowsFeature('movement', 'lists')).toBe(true);
  });

  it('gates Movement-only features off free and grassroots', () => {
    expect(planAllowsFeature('free', 'canvassing')).toBe(false);
    expect(planAllowsFeature('grassroots', 'deliveries')).toBe(false);
    expect(planAllowsFeature('movement', 'canvassing')).toBe(true);
    expect(planAllowsFeature('enterprise', 'deliveries')).toBe(true);
  });

  it('treats unknown/missing plan values as free (fail closed)', () => {
    expect(planAllowsFeature(null, 'forms')).toBe(false);
    expect(planAllowsFeature('mystery-tier', 'forms')).toBe(false);
  });

  it('resolves legacy aliases before gating', () => {
    expect(planAllowsFeature('representative', 'canvassing')).toBe(true); // retired key → movement
    expect(planAllowsFeature('starter', 'forms')).toBe(false); // renamed key → free
  });

  it('is self-consistent: every gated feature unlocks at its own minPlan and not on free', () => {
    for (const feature of Object.keys(GATED_FEATURES) as GatedFeature[]) {
      const { minPlan } = GATED_FEATURES[feature];
      expect(planAllowsFeature(minPlan, feature)).toBe(true);
      expect(planAllowsFeature('free', feature)).toBe(false); // nothing gated is free-tier
    }
  });
});

/**
 * FEATURE_MATRIX drives the marketing site's comparison table; GATED_FEATURES is what the backend
 * actually enforces. They are two hand-synced lists (see the comment on FEATURE_MATRIX), and when
 * they drift the site makes a promise the code refuses to keep.
 *
 * That is not hypothetical. Until 2026-07-27 the matrix advertised "300+ integrations" as
 * `free: true` while the API had no gate at all, and Forms was enforced at `grassroots` — the site
 * and the server disagreed in both directions at once. The test that was supposed to catch this
 * ("mirrors the FEATURE_MATRIX split for every gated feature") never read FEATURE_MATRIX: it
 * compared `planAllowsFeature` to GATED_FEATURES, which is that function's own definition, so it
 * was tautologically green. Worse than no test — the row looked covered.
 *
 * This is the real check. The label map is hand-written (matrix rows are marketing prose, not
 * feature keys), but it is exhaustively verified in both directions below, so a new gated feature
 * or a renamed row fails here rather than silently going unchecked.
 */
describe('FEATURE_MATRIX ↔ GATED_FEATURES', () => {
  /** Every matrix row that describes a gated feature, by the feature that gates it. */
  const ROWS_BY_FEATURE: Record<GatedFeature, readonly string[]> = {
    inbox: ['Shared inbox (Gmail & Microsoft mailbox sync)'],
    forms: ['Forms'],
    donations: ['Donations'],
    api: ['API access & 300+ integrations'],
    automations: ['Automations'],
    lists: ['Lists (segments)'],
    volunteers: ['Volunteer management (teams & events)'],
    canvassing: ['Canvassing companion app', 'Turf cutting', 'Walk lists & routes', 'Field reports'],
    deliveries: ['Deliveries companion app', 'Yard sign requests', 'Route optimization', 'Delivery monitoring'],
    companions: ['Companion volunteer access & monitoring'],
  };

  const allRows = FEATURE_MATRIX.flatMap((group) => group.rows);
  const rowByLabel = new Map(allRows.map((row) => [row.label, row]));

  it('maps every gated feature to at least one matrix row', () => {
    // Adding a GATED_FEATURES entry without a matrix row means the site never mentions a
    // restriction the server enforces — a customer discovers it by hitting a 403.
    for (const feature of Object.keys(GATED_FEATURES) as GatedFeature[]) {
      expect(ROWS_BY_FEATURE[feature]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('references only labels that actually exist in the matrix', () => {
    // Catches a renamed row, which would otherwise make the check below silently vacuous.
    for (const labels of Object.values(ROWS_BY_FEATURE)) {
      for (const label of labels) {
        expect(rowByLabel.has(label), `no FEATURE_MATRIX row labelled "${label}"`).toBe(true);
      }
    }
  });

  it('advertises exactly what the backend enforces, per plan', () => {
    for (const [feature, labels] of Object.entries(ROWS_BY_FEATURE) as [GatedFeature, readonly string[]][]) {
      for (const label of labels) {
        const row = rowByLabel.get(label);
        if (!row) throw new Error(`no FEATURE_MATRIX row labelled "${label}"`);

        for (const plan of ['free', 'grassroots', 'movement'] as const) {
          expect(row.values[plan], `"${label}" on ${plan}`).toBe(planAllowsFeature(plan, feature));
        }
      }
    }
  });

  it('does not claim any ungated row is unavailable on a plan it is actually on', () => {
    // The inverse drift: a row showing ✗ for a feature nothing gates. Boolean-valued rows only —
    // string cells ("Up to 1,000", "2 seats") are quantities, not availability.
    const gatedLabels = new Set(Object.values(ROWS_BY_FEATURE).flat());
    for (const row of allRows) {
      if (gatedLabels.has(row.label)) continue;
      if (typeof row.values.free !== 'boolean') continue;
      expect(row.values.free, `"${row.label}" is shown as paid-only but nothing gates it`).toBe(true);
    }
  });
});

describe('getPlanDef / planDisplayName edge cases', () => {
  it('returns undefined for missing or unknown plan values', () => {
    expect(getPlanDef(null)).toBeUndefined();
    expect(getPlanDef(undefined)).toBeUndefined();
    expect(getPlanDef('')).toBeUndefined();
    expect(getPlanDef('mystery-tier')).toBeUndefined();
  });

  it('planDisplayName uses the definition name, echoes unknown values, and defaults to Free', () => {
    expect(planDisplayName('grassroots')).toBe(PLANS_BY_KEY.grassroots.name);
    expect(planDisplayName('mystery-tier')).toBe('mystery-tier');
    expect(planDisplayName(null)).toBe('Free');
  });
});

describe('quantity ladder helpers', () => {
  it('maxQuantity equals the bracket count for laddered plans and Infinity for enterprise', () => {
    for (const key of PURCHASABLE_PLAN_KEYS) {
      const pricing = PLANS_BY_KEY[key].pricing;
      if (!pricing) throw new Error(`expected pricing for purchasable plan ${key}`);
      expect(maxQuantity(key)).toBe(pricing.brackets.length);
    }
    expect(maxQuantity('enterprise')).toBe(Infinity);
  });

  it('bracketForQuantity clamps out-of-range quantities into the ladder', () => {
    const pricing = PLANS_BY_KEY.grassroots.pricing;
    if (!pricing) throw new Error('expected grassroots pricing');
    const first = pricing.brackets[0];
    const last = pricing.brackets[pricing.brackets.length - 1];

    expect(bracketForQuantity('grassroots', 0)).toEqual(first);
    expect(bracketForQuantity('grassroots', -5)).toEqual(first);
    expect(bracketForQuantity('grassroots', pricing.brackets.length + 99)).toEqual(last);
  });

  it('bracketForQuantity throws for the ladderless enterprise plan', () => {
    expect(() => bracketForQuantity('enterprise', 1)).toThrow(/no pricing ladder/);
  });

  it('subscriberCapForQuantity matches the bracket upTo across every purchasable quantity', () => {
    for (const key of PURCHASABLE_PLAN_KEYS) {
      const pricing = PLANS_BY_KEY[key].pricing;
      if (!pricing) throw new Error(`expected pricing for ${key}`);
      pricing.brackets.forEach((bracket, i) => {
        expect(subscriberCapForQuantity(key, i + 1)).toBe(bracket.upTo);
        expect(priceForQuantity(key, i + 1)).toBe(bracket.price);
      });
    }
  });
});

describe('startingPriceUsd', () => {
  it('is 0 for free, the first bracket price for paid tiers, and null for enterprise', () => {
    expect(startingPriceUsd(PLANS_BY_KEY.free)).toBe(0);
    for (const key of PURCHASABLE_PLAN_KEYS) {
      const pricing = PLANS_BY_KEY[key].pricing;
      if (!pricing) throw new Error(`expected pricing for ${key}`);
      expect(startingPriceUsd(PLANS_BY_KEY[key])).toBe(pricing.brackets[0]?.price);
    }
    expect(startingPriceUsd(PLANS_BY_KEY.enterprise)).toBeNull();
  });

  it('agrees with startingPriceLabel for every plan', () => {
    for (const plan of Object.values(PLANS_BY_KEY)) {
      const usd = startingPriceUsd(plan);
      const label = startingPriceLabel(plan);
      if (usd === null) expect(label).toBe('Custom');
      else if (usd === 0) expect(label).toBe('$0');
      else expect(label).toBe(`From $${usd}`);
    }
  });
});
