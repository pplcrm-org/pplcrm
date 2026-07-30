import { describe, expect, it } from 'vitest';

import { ORG_MODES, ORG_MODE_IS_ELECTORAL, ORG_MODE_MODULE_DEFAULTS } from '../../../../../../libs/common/src';
import {
  CAMPAIGN_STARTER_TAGS,
  FUNDRAISING_STARTER_FORMS,
  MODE_ISSUES,
  SHARED_STARTER_TAGS,
  SIGN_STARTER_TAGS,
  STARTER_ISSUES,
  STARTER_TAGS,
  fundraisingFormsFor,
  starterFormsFor,
  starterTagsFor,
} from './onboarding-seed';

/**
 * The starter vocabulary itself. Whether a mode's DEMO DATA references vocabulary that mode
 * actually seeds is the other half of this invariant and lives in
 * `modules/demo/demo-datasets.spec.ts`, next to the datasets it checks.
 */
describe('starter vocabulary', () => {
  it('keeps STARTER_TAGS as the widest (campaign) set', () => {
    expect(STARTER_TAGS.map((t) => t.name)).toEqual([
      ...SHARED_STARTER_TAGS.map((t) => t.name),
      ...CAMPAIGN_STARTER_TAGS.map((t) => t.name),
      ...SIGN_STARTER_TAGS.map((t) => t.name),
    ]);
    expect(starterTagsFor('campaign').map((t) => t.name)).toEqual(STARTER_TAGS.map((t) => t.name));
  });

  it('gives electoral modes the campaign tags and withholds them from the rest', () => {
    for (const mode of ORG_MODES) {
      const names = new Set(starterTagsFor(mode).map((t) => t.name));
      for (const tag of CAMPAIGN_STARTER_TAGS) {
        expect(names.has(tag.name), `${mode} (electoral=${ORG_MODE_IS_ELECTORAL[mode]}) tag "${tag.name}"`).toBe(
          ORG_MODE_IS_ELECTORAL[mode],
        );
      }
    }
  });

  /**
   * A lawn sign needs a candidate, not merely an election: a constituency office runs no sign
   * operation, so the tag and the yard-sign request form are campaign-only even though the office
   * is electoral. This is the distinction that used to be missing.
   */
  it('keeps the sign operation to campaign mode', () => {
    for (const mode of ORG_MODES) {
      const names = new Set(starterTagsFor(mode).map((t) => t.name));
      const slugs = new Set(starterFormsFor(mode).map((f) => f.slug));
      for (const tag of SIGN_STARTER_TAGS) {
        expect(names.has(tag.name), `${mode} tag "${tag.name}"`).toBe(mode === 'campaign');
      }
      expect(slugs.has('yard-sign-request'), `${mode} yard-sign form`).toBe(mode === 'campaign');
    }
  });

  it('does not repeat a tag name within any mode', () => {
    for (const mode of ORG_MODES) {
      const names = starterTagsFor(mode).map((t) => t.name);
      expect(new Set(names).size, `${mode} seeds a duplicate tag name`).toBe(names.length);
    }
  });

  it('does not repeat a form slug within any mode', () => {
    for (const mode of ORG_MODES) {
      const slugs = starterFormsFor(mode).map((f) => f.slug);
      expect(new Set(slugs).size, `${mode} seeds a duplicate form slug`).toBe(slugs.length);
    }
  });

  it('gives every mode the forms a workspace cannot function without', () => {
    for (const mode of ORG_MODES) {
      const slugs = new Set(starterFormsFor(mode).map((f) => f.slug));
      for (const slug of ['volunteer-signup', 'newsletter-sign-up']) {
        expect(slugs.has(slug), `${mode} does not seed the "${slug}" starter form`).toBe(true);
      }
    }
  });

  /**
   * The giving pages follow the mode's own Donations default, so a workspace never opens with a
   * fundraising form parked on a page its sidebar does not link to.
   */
  it('seeds the giving pages exactly for the modes that fundraise', () => {
    for (const mode of ORG_MODES) {
      const slugs = new Set(starterFormsFor(mode).map((f) => f.slug));
      const fundraises = ORG_MODE_MODULE_DEFAULTS[mode].donations;
      for (const slug of ['one-time-donation', 'recurring-donation', 'fundraising-pledge']) {
        expect(slugs.has(slug), `${mode} (donations=${fundraises}) form "${slug}"`).toBe(fundraises);
      }
    }
  });

  /** Renaming a giving page is a wording change; its slug is a public URL and must not move. */
  it('renames the giving pages per mode without moving a slug', () => {
    const canonical = FUNDRAISING_STARTER_FORMS.map((f) => f.slug);
    for (const mode of ORG_MODES.filter((m) => ORG_MODE_MODULE_DEFAULTS[m].donations)) {
      expect(
        fundraisingFormsFor(mode).map((f) => f.slug),
        mode,
      ).toEqual(canonical);
    }
    expect(fundraisingFormsFor('church').map((f) => f.name)).toEqual([
      'Monthly giving',
      'Give online',
      'Giving pledge',
    ]);
  });

  it('gives every mode a non-empty issue vocabulary', () => {
    for (const mode of ORG_MODES) {
      expect(MODE_ISSUES[mode].length, `${mode} has no starter issues`).toBeGreaterThan(0);
    }
  });

  it('keeps the electoral modes on the original issue list', () => {
    for (const mode of ORG_MODES.filter((m) => ORG_MODE_IS_ELECTORAL[m])) {
      expect(MODE_ISSUES[mode]).toBe(STARTER_ISSUES);
    }
  });

  /** Structured concepts (donor/supporter/subscriber) were deliberately retired as tags. */
  it('does not resurrect structured concepts as tags', () => {
    for (const mode of ORG_MODES) {
      for (const { name } of starterTagsFor(mode)) {
        expect(['donor', 'supporter', 'subscriber', 'volunteer']).not.toContain(name);
      }
    }
  });
});
