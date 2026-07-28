import { describe, expect, it } from 'vitest';

import { ORG_MODES, ORG_MODE_IS_ELECTORAL, ORG_MODE_MODULE_DEFAULTS, ORG_MODE_SEEDS_DEMO } from '@common';
import type { OrgMode } from '@common';

import { CAMPAIGN_STARTER_TAGS, MODE_ISSUES, starterFormsFor, starterTagsFor } from '../auth/onboarding-seed';
import { DEMO_DATASETS } from './demo-datasets';
import type { DemoDataset } from './demo-data-types';

/**
 * The invariant this file exists for.
 *
 * A demo dataset attaches people and households to starter tags BY NAME, issue assignments to
 * starter issues BY NAME, and submissions to starter forms BY SLUG — and `demo-seed.ts` SILENTLY
 * SKIPS a name or slug it cannot match rather than throwing. So a mode seeded with a dataset that
 * references vocabulary its signup never creates fails quietly, in production, as missing data
 * nobody notices. These tests are the only thing that catches it.
 *
 * Checks run against `starterTagsFor` / `starterFormsFor` — the same functions the seeder calls —
 * so they cannot drift from what signup actually creates.
 */
describe('demo datasets', () => {
  const seeded: [OrgMode, DemoDataset][] = ORG_MODES.flatMap((mode) => {
    const dataset = DEMO_DATASETS[mode];
    return dataset ? [[mode, dataset] as [OrgMode, DemoDataset]] : [];
  });

  it('seeds a demo workspace for at least one mode', () => {
    expect(seeded.length).toBeGreaterThan(0);
  });

  /**
   * ORG_MODE_SEEDS_DEMO (libs/common) is a hand-kept mirror of this registry, because the
   * frontend tour needs the answer and cannot import backend code. Nothing but this test keeps
   * the two honest.
   */
  it('agrees with ORG_MODE_SEEDS_DEMO in libs/common', () => {
    for (const mode of ORG_MODES) {
      expect(ORG_MODE_SEEDS_DEMO[mode], `ORG_MODE_SEEDS_DEMO.${mode} disagrees with DEMO_DATASETS.${mode}`).toBe(
        DEMO_DATASETS[mode] !== null,
      );
    }
  });

  for (const [mode, dataset] of seeded) {
    describe(mode, () => {
      it('references only tags this mode seeds', () => {
        const available = new Set(starterTagsFor(mode).map((t) => t.name));
        const referenced = new Set([
          ...dataset.households.flatMap((h) => h.tags ?? []),
          ...dataset.persons.flatMap((p) => p.tags ?? []),
        ]);
        for (const tag of referenced) {
          expect(available.has(tag), `${mode}'s dataset references tag "${tag}", which its signup does not seed`).toBe(
            true,
          );
        }
      });

      it('references only issues this mode seeds', () => {
        const available = new Set(MODE_ISSUES[mode].map((i) => i.name));
        for (const { issue } of dataset.issueAssignments) {
          expect(
            available.has(issue),
            `${mode}'s dataset references issue "${issue}", which its signup does not seed`,
          ).toBe(true);
        }
      });

      it('posts submissions only to forms this mode seeds', () => {
        const available = new Set(starterFormsFor(mode).map((f) => f.slug));
        for (const { formSlug } of dataset.submissions) {
          expect(
            available.has(formSlug),
            `${mode}'s dataset posts to form "${formSlug}", which its signup does not seed`,
          ).toBe(true);
        }
      });

      /**
       * Belt and braces over the tag check: electoral vocabulary is the specific thing that would
       * read as wrong rather than merely missing if it leaked into a church or a charity.
       */
      it('uses electoral vocabulary only in electoral modes', () => {
        if (ORG_MODE_IS_ELECTORAL[mode]) return;
        const electoral = new Set(CAMPAIGN_STARTER_TAGS.map((t) => t.name));
        const referenced = [
          ...dataset.households.flatMap((h) => h.tags ?? []),
          ...dataset.persons.flatMap((p) => p.tags ?? []),
        ];
        for (const tag of referenced) {
          expect(electoral.has(tag), `${mode} is not electoral but its dataset uses the tag "${tag}"`).toBe(false);
        }
      });

      /**
       * A turf the sidebar does not link to is worse than no canvassing: the data exists, the
       * page that shows it is hidden, and the only symptom is a number that never adds up.
       */
      it('seeds field data only for modules this mode shows', () => {
        const defaults = ORG_MODE_MODULE_DEFAULTS[mode];
        if (!defaults.canvassing) {
          expect(dataset.turfs, `${mode} hides canvassing but its dataset seeds turfs`).toHaveLength(0);
        }
        if (!defaults.deliveries) {
          expect(dataset.deliveryRequests, `${mode} hides deliveries but its dataset seeds requests`).toHaveLength(0);
          expect(dataset.deliveryRoutes, `${mode} hides deliveries but its dataset seeds routes`).toHaveLength(0);
        }
      });

      /** Every person/household key a dataset points at has to exist inside that same dataset. */
      it('resolves every internal key it references', () => {
        const people = new Set(dataset.persons.map((p) => p.key));
        const households = new Set(dataset.households.map((h) => h.key));
        const companies = new Set(dataset.companies.map((c) => c.key));

        for (const p of dataset.persons) {
          if (p.household) expect(households.has(p.household), `person ${p.key} → household ${p.household}`).toBe(true);
          if (p.company) expect(companies.has(p.company), `person ${p.key} → company ${p.company}`).toBe(true);
        }
        const peopleRefs: [string, string][] = [
          ...dataset.lists.flatMap((l) => l.members.map((m): [string, string] => [`list ${l.key}`, m])),
          ...dataset.team.members.map((m): [string, string] => ['team', m]),
          ...dataset.issueAssignments.flatMap((a) => a.people.map((m): [string, string] => [`issue ${a.issue}`, m])),
          ...dataset.submissions.map((s): [string, string] => [`submission ${s.formSlug}`, s.person]),
          ...dataset.emails.map((e): [string, string] => [`email "${e.subject}"`, e.person]),
          ...dataset.donations.map((d): [string, string] => ['donation', d.person]),
          ...dataset.pledges.map((p): [string, string] => [`pledge ${p.key}`, p.person]),
          ...dataset.volunteerEvents.flatMap((ev) =>
            ev.shifts.map((sh): [string, string] => [`event ${ev.key}`, sh.person]),
          ),
        ];
        for (const [where, key] of peopleRefs) {
          expect(people.has(key), `${where} references unknown person "${key}"`).toBe(true);
        }
      });
    });
  }
});
