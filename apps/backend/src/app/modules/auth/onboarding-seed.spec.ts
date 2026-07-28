import { describe, expect, it } from 'vitest';

import { ORG_MODES, ORG_MODE_SEEDS_DEMO } from '../../../../../../libs/common/src';
import {
  CAMPAIGN_STARTER_TAGS,
  MODE_EXTRA_TAGS,
  MODE_ISSUES,
  MODE_STARTER_FORMS,
  SHARED_STARTER_TAGS,
  STARTER_ISSUES,
  STARTER_TAGS,
} from './onboarding-seed';
import { DEMO_HOUSEHOLDS, DEMO_ISSUE_ASSIGNMENTS, DEMO_PERSONS, DEMO_SUBMISSIONS } from '../demo/demo-seed-data';

/** Tag/issue names a mode's signup actually creates. */
function tagNamesFor(mode: (typeof ORG_MODES)[number]): Set<string> {
  return new Set([
    ...SHARED_STARTER_TAGS.map((t) => t.name),
    ...(ORG_MODE_SEEDS_DEMO[mode] ? CAMPAIGN_STARTER_TAGS.map((t) => t.name) : []),
    ...MODE_EXTRA_TAGS[mode].map((t) => t.name),
  ]);
}

/** Starter form slugs a mode's signup actually creates, campaign-only ones included. */
function formSlugsFor(mode: (typeof ORG_MODES)[number]): Set<string> {
  const universal = [
    'volunteer-signup',
    'newsletter-sign-up',
    'recurring-donation',
    'one-time-donation',
    'fundraising-pledge',
  ];
  const campaignOnly = ['yard-sign-request', 'issues-survey'];
  return new Set([
    ...universal,
    ...(ORG_MODE_SEEDS_DEMO[mode] ? campaignOnly : []),
    ...MODE_STARTER_FORMS[mode].map((f) => f.slug),
  ]);
}

describe('onboarding seeds', () => {
  /**
   * The invariant this file exists for.
   *
   * The demo seeder attaches demo people and households to starter tags BY NAME, demo issue
   * assignments to starter issues BY NAME, and demo submissions to starter forms BY SLUG — and
   * `demo-seed.ts` SILENTLY SKIPS a slug it cannot match rather than throwing. So a mode that
   * seeds the demo dataset without seeding the vocabulary it references fails quietly, in
   * production, as missing data nobody notices. These tests are the only thing that catches it.
   */
  describe('every demo-seeding mode has the vocabulary its demo data references', () => {
    const demoModes = ORG_MODES.filter((m) => ORG_MODE_SEEDS_DEMO[m]);

    it('seeds the demo dataset for at least one mode', () => {
      expect(demoModes.length).toBeGreaterThan(0);
    });

    for (const mode of demoModes) {
      it(`${mode}: every tag referenced by demo households and people exists`, () => {
        const seeded = tagNamesFor(mode);
        const referenced = new Set([
          ...DEMO_HOUSEHOLDS.flatMap((h) => h.tags ?? []),
          ...DEMO_PERSONS.flatMap((p) => p.tags ?? []),
        ]);
        for (const tag of referenced) {
          expect(seeded.has(tag), `demo data references tag "${tag}", which ${mode} does not seed`).toBe(true);
        }
      });

      it(`${mode}: every issue referenced by demo assignments exists`, () => {
        const seeded = new Set(MODE_ISSUES[mode].map((i) => i.name));
        for (const { issue } of DEMO_ISSUE_ASSIGNMENTS) {
          expect(seeded.has(issue), `demo data references issue "${issue}", which ${mode} does not seed`).toBe(true);
        }
      });

      it(`${mode}: every form slug referenced by demo submissions exists`, () => {
        const seeded = formSlugsFor(mode);
        for (const { formSlug } of DEMO_SUBMISSIONS) {
          expect(seeded.has(formSlug), `demo data posts to form "${formSlug}", which ${mode} does not seed`).toBe(true);
        }
      });
    }
  });

  describe('starter vocabulary', () => {
    it('keeps STARTER_TAGS as the full campaign-mode set', () => {
      expect(STARTER_TAGS.map((t) => t.name)).toEqual([
        ...SHARED_STARTER_TAGS.map((t) => t.name),
        ...CAMPAIGN_STARTER_TAGS.map((t) => t.name),
      ]);
    });

    it('does not repeat a tag name within any mode', () => {
      for (const mode of ORG_MODES) {
        const names = [
          ...SHARED_STARTER_TAGS.map((t) => t.name),
          ...(ORG_MODE_SEEDS_DEMO[mode] ? CAMPAIGN_STARTER_TAGS.map((t) => t.name) : []),
          ...MODE_EXTRA_TAGS[mode].map((t) => t.name),
        ];
        expect(new Set(names).size, `${mode} seeds a duplicate tag name`).toBe(names.length);
      }
    });

    it('does not repeat a form slug within any mode', () => {
      for (const mode of ORG_MODES) {
        const slugs = [...formSlugsFor(mode)];
        expect(new Set(slugs).size, `${mode} seeds a duplicate form slug`).toBe(slugs.length);
      }
    });

    it('gives every mode a non-empty issue vocabulary', () => {
      for (const mode of ORG_MODES) {
        expect(MODE_ISSUES[mode].length, `${mode} has no starter issues`).toBeGreaterThan(0);
      }
    });

    it('keeps the demo modes on the original issue list', () => {
      for (const mode of ORG_MODES.filter((m) => ORG_MODE_SEEDS_DEMO[m])) {
        expect(MODE_ISSUES[mode]).toBe(STARTER_ISSUES);
      }
    });

    /** Structured concepts (donor/supporter/subscriber) were deliberately retired as tags. */
    it('does not resurrect structured concepts as tags', () => {
      for (const mode of ORG_MODES) {
        for (const name of tagNamesFor(mode)) {
          expect(['donor', 'supporter', 'subscriber', 'volunteer']).not.toContain(name);
        }
      }
    });
  });
});
