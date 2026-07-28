import { describe, expect, it } from 'vitest';

import { ORG_MODES, ORG_MODE_IS_ELECTORAL } from '../../../../../../libs/common/src';
import {
  CAMPAIGN_STARTER_TAGS,
  MODE_ISSUES,
  SHARED_STARTER_TAGS,
  STARTER_ISSUES,
  STARTER_TAGS,
  starterFormsFor,
  starterTagsFor,
} from './onboarding-seed';

/**
 * The starter vocabulary itself. Whether a mode's DEMO DATA references vocabulary that mode
 * actually seeds is the other half of this invariant and lives in
 * `modules/demo/demo-datasets.spec.ts`, next to the datasets it checks.
 */
describe('starter vocabulary', () => {
  it('keeps STARTER_TAGS as the full electoral set', () => {
    expect(STARTER_TAGS.map((t) => t.name)).toEqual([
      ...SHARED_STARTER_TAGS.map((t) => t.name),
      ...CAMPAIGN_STARTER_TAGS.map((t) => t.name),
    ]);
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
      for (const slug of ['volunteer-signup', 'newsletter-sign-up', 'one-time-donation']) {
        expect(slugs.has(slug), `${mode} does not seed the "${slug}" starter form`).toBe(true);
      }
    }
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
