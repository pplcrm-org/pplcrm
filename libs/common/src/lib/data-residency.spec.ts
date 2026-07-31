import { describe, expect, it } from 'vitest';

import { DATA_RESIDENCY_MIN_PLAN, PLANS_BY_KEY, planAllowsDataResidency } from './billing/plans';
import {
  DATA_REGIONS,
  DATA_REGION_CHOICES,
  DATA_REGION_CHOICE_DESCRIPTIONS,
  DATA_REGION_CHOICE_LABELS,
  DEFAULT_DATA_REGION,
  DEFAULT_DATA_REGION_CHOICE,
  LIVE_DATA_REGIONS,
  NO_REGION_PREFERENCE,
  hasRegionPreference,
  hostingRegionFor,
  isChoicePendingRegion,
  isDataRegion,
  isDataRegionChoice,
  isDataRegionLive,
} from './data-residency';

describe('data-residency', () => {
  describe('the two sets', () => {
    it('offers no-preference plus the three real regions', () => {
      expect([...DATA_REGION_CHOICES]).toEqual(['any', 'ca', 'us', 'eu']);
      expect([...DATA_REGIONS]).toEqual(['ca', 'us', 'eu']);
    });

    // The distinction this file exists to protect: 'any' is an answer, not a place.
    it('does not treat no-preference as a storage location', () => {
      expect(isDataRegion(NO_REGION_PREFERENCE)).toBe(false);
      expect(isDataRegionChoice(NO_REGION_PREFERENCE)).toBe(true);
    });

    it('gives every choice a non-empty label and description', () => {
      for (const choice of DATA_REGION_CHOICES) {
        expect(DATA_REGION_CHOICE_LABELS[choice], choice).toBeTypeOf('string');
        expect(DATA_REGION_CHOICE_LABELS[choice].trim(), choice).not.toBe('');
        expect(DATA_REGION_CHOICE_DESCRIPTIONS[choice], choice).toBeTypeOf('string');
        expect(DATA_REGION_CHOICE_DESCRIPTIONS[choice].trim(), choice).not.toBe('');
      }
    });
  });

  describe('defaults', () => {
    // Signup must not present a paid choice as already made: the default has to be the free,
    // truthful answer, not a region.
    it('defaults to no preference, and stores data in the region the platform runs in', () => {
      expect(DEFAULT_DATA_REGION_CHOICE).toBe(NO_REGION_PREFERENCE);
      expect(hasRegionPreference(DEFAULT_DATA_REGION_CHOICE)).toBe(false);
      expect(hostingRegionFor(DEFAULT_DATA_REGION_CHOICE)).toBe(DEFAULT_DATA_REGION);
      expect(isDataRegionLive(DEFAULT_DATA_REGION)).toBe(true);
    });
  });

  describe('isDataRegionChoice', () => {
    it('accepts every declared choice', () => {
      for (const choice of DATA_REGION_CHOICES) {
        expect(isDataRegionChoice(choice), choice).toBe(true);
      }
    });

    it('rejects anything else', () => {
      for (const value of ['CA', 'canada', 'uk', 'none', '', null, undefined, 0, {}]) {
        expect(isDataRegionChoice(value), String(value)).toBe(false);
      }
    });
  });

  describe('hasRegionPreference', () => {
    it('is true for every real region and false only for no-preference', () => {
      expect(hasRegionPreference(NO_REGION_PREFERENCE)).toBe(false);
      for (const region of DATA_REGIONS) {
        expect(hasRegionPreference(region), region).toBe(true);
      }
    });
  });

  describe('isChoicePendingRegion', () => {
    // No-preference must never look like an unmet request, or the signup form would warn
    // every user who touched nothing and ops would chase signups that asked for nothing.
    it('is false for no preference', () => {
      expect(isChoicePendingRegion(NO_REGION_PREFERENCE)).toBe(false);
    });

    it('is true exactly for the regions with no hosting yet', () => {
      for (const region of DATA_REGIONS) {
        expect(isChoicePendingRegion(region), region).toBe(!isDataRegionLive(region));
      }
    });
  });

  describe('hostingRegionFor', () => {
    it('returns the chosen region when that region is live', () => {
      for (const region of LIVE_DATA_REGIONS) {
        expect(hostingRegionFor(region), region).toBe(region);
      }
    });

    // The point of the helper: a recorded preference must never be mistaken for a fact about
    // where the rows are. A region with no infrastructure resolves to the region that has it.
    it('falls back to the default region for a region that is not open yet', () => {
      const notOpen = DATA_REGIONS.filter((r) => !isDataRegionLive(r));
      expect(notOpen.length, 'this test is vacuous once every region is live').toBeGreaterThan(0);

      for (const region of notOpen) {
        expect(hostingRegionFor(region), region).toBe(DEFAULT_DATA_REGION);
      }
    });

    it('always names a real region, never a choice', () => {
      for (const choice of DATA_REGION_CHOICES) {
        expect(isDataRegion(hostingRegionFor(choice)), choice).toBe(true);
      }
    });
  });

  // The signup form tells every user that naming a region needs the Movement plan, and the
  // pricing page renders the same rule. Both read these, so both move together.
  describe('plan requirement', () => {
    it('requires the Movement plan and refuses the lower tiers', () => {
      expect(DATA_RESIDENCY_MIN_PLAN).toBe('movement');
      expect(planAllowsDataResidency('movement')).toBe(true);
      expect(planAllowsDataResidency('enterprise')).toBe(true);
      expect(planAllowsDataResidency('grassroots')).toBe(false);
      expect(planAllowsDataResidency('free')).toBe(false);
      expect(planAllowsDataResidency(null)).toBe(false);
    });

    it('names a plan that exists, since the signup notice prints its name', () => {
      expect(PLANS_BY_KEY[DATA_RESIDENCY_MIN_PLAN].name).toBe('Movement');
    });
  });
});
