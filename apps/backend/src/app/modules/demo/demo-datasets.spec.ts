import { describe, expect, it } from 'vitest';

import {
  ORG_MODES,
  ORG_MODE_IS_ELECTORAL,
  ORG_MODE_MODULE_DEFAULTS,
  ORG_MODE_SEEDS_DEMO,
  RECEIPT_REGIMES,
} from '@common';
import type { OrgMode, ReceiptRegimeId } from '@common';

import {
  CAMPAIGN_STARTER_TAGS,
  MODE_ISSUES,
  SIGN_STARTER_TAGS,
  starterFormsFor,
  starterTagsFor,
} from '../auth/onboarding-seed';
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
        const electoral = new Set([...CAMPAIGN_STARTER_TAGS, ...SIGN_STARTER_TAGS].map((t) => t.name));
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
        if (!defaults.donations) {
          expect(dataset.donations, `${mode} hides donations but its dataset seeds gifts`).toHaveLength(0);
          expect(dataset.pledges, `${mode} hides donations but its dataset seeds pledges`).toHaveLength(0);
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

      /**
       * Receipts are the one part of a dataset that points at gifts BY ARRAY INDEX, so inserting
       * a donation in the middle of the list silently re-points every receipt after it at the
       * wrong donor. The seeder skips an out-of-range index without complaining, which makes a
       * shifted index look like a receipt that merely failed to seed.
       */
      it('issues receipts against gifts that exist, for donors it can address', () => {
        const refs = new Set<number>();
        for (const r of dataset.receipts) {
          const gift = dataset.donations[r.donation];
          expect(
            gift,
            `${mode} receipt ref ${r.ref} points at donation index ${r.donation}, which does not exist`,
          ).toBeDefined();
          if (!gift) continue;

          expect(refs.has(r.ref), `${mode} reuses receipt ref ${r.ref}`).toBe(false);
          refs.add(r.ref);

          // A CRA/political receipt prints the donor's mailing address; the live issue path
          // refuses to issue without one, so seeded receipts must not depict what it forbids.
          const donor = dataset.persons.find((p) => p.key === gift.person);
          expect(
            donor?.household,
            `${mode} receipts ${gift.person}, who has no household to address it to`,
          ).toBeTruthy();

          const advantage = r.advantageCents ?? 0;
          expect(
            advantage >= 0 && advantage < gift.amountCents,
            `${mode} receipt ref ${r.ref} has a bad advantage`,
          ).toBe(true);
        }

        // A replacement must be issued AFTER the receipt it replaces, or the seeder's date-ordered
        // numbering gives it the lower serial and the pair reads backwards on the page.
        for (const r of dataset.receipts) {
          if (r.replacesRef == null) continue;
          const predecessor = dataset.receipts.find((p) => p.ref === r.replacesRef);
          expect(predecessor, `${mode} receipt ref ${r.ref} replaces unknown ref ${r.replacesRef}`).toBeDefined();
          expect(predecessor?.status, `${mode} receipt ref ${r.replacesRef} is replaced but not cancelled`).toBe(
            'cancelled',
          );
          expect(
            (predecessor?.issuedDaysAgo ?? 0) > r.issuedDaysAgo,
            `${mode} receipt ref ${r.ref} is dated before the receipt it replaces`,
          ).toBe(true);
        }
      });

      /**
       * Seeding receipts writes `receipts.*` workspace settings, and the receipts page refuses to
       * issue anything while a field the regime prescribes is blank. A dataset that seeds receipts
       * under a half-configured regime hands the user a page that only shows an error.
       */
      it('configures the regime its receipts are issued under', () => {
        if (dataset.receipts.length === 0) {
          expect(
            Object.keys(dataset.receiptSettings),
            `${mode} seeds no receipts, so its receipts.* settings would never be used`,
          ).toHaveLength(0);
          return;
        }

        const regime = dataset.receiptSettings['receipts.regime'];
        expect(typeof regime === 'string' && regime in RECEIPT_REGIMES, `${mode} regime "${regime}" is not real`).toBe(
          true,
        );
        if (typeof regime !== 'string' || !(regime in RECEIPT_REGIMES)) return;

        const spec = RECEIPT_REGIMES[regime as ReceiptRegimeId];
        expect(spec.issuance, `${mode} seeds receipts under ${regime}, whose receipts are issued externally`).toBe(
          'internal',
        );
        // Only the blocking fields. The signature image is advisory and a dataset cannot supply
        // one anyway (it is an uploaded file, not a settings string), which is exactly why
        // issuance does not depend on it.
        for (const field of spec.requiredIssuerFields) {
          expect(dataset.receiptSettings[`receipts.${field}`], `${mode} is missing receipts.${field}`).toBeTruthy();
        }
      });
    });
  }
});
