import { describe, expect, it } from 'vitest';

import {
  BOUNDARY_MAX_VERTICES_PER_FEATURE,
  JURISDICTIONS,
  ORG_MODES,
  ORG_MODE_IS_ELECTORAL,
  ORG_MODE_MODULE_DEFAULTS,
  ORG_MODE_SEEDS_DEMO,
  RECEIPT_REGIMES,
  boundaryBBoxOf,
  countBoundaryVertices,
  isJurisdictionId,
  regionsForCountry,
} from '@common';
import { boundaryGeometrySchema } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import type { OrgMode, ReceiptRegimeId } from '@common';

import { isPointInPolygon } from '../../lib/gis/point-in-polygon';
import { cutTurfs } from '../canvassing/lib/cutting-engine';
import {
  CAMPAIGN_STARTER_TAGS,
  MODE_ISSUES,
  SIGN_STARTER_TAGS,
  starterFormsFor,
  starterTagsFor,
} from '../auth/onboarding-seed';
import { DEMO_DATASETS } from './demo-datasets';
import type { DemoDataset } from './demo-data-types';
import type { PlacePack } from './demo-data-places';
import {
  DEMO_AREA_KEYS,
  DEMO_ROUTE_START_KEYS,
  DEMO_VENUE_KEYS,
  PLACE_PACKS,
  areaGeometry,
  housesOn,
} from './demo-data-places';

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
   * 555-0100..0199 is the only exchange block reserved for fiction in the North American
   * numbering plan. A seeded number outside it is potentially assignable — and the volunteer
   * flows can address a real Twilio text at it (REVIEW7 C5). packPhone only rewrites the area
   * code, so the local part must be right in every dataset, hand-written or generated.
   */
  it('keeps every seeded mobile number inside the fictional 555-01XX block', () => {
    for (const [mode, dataset] of seeded) {
      for (const person of dataset.persons) {
        if (person.mobile == null) continue;
        expect(/-555-01\d\d$/.test(person.mobile), `${mode} person ${person.key} mobile ${person.mobile}`).toBe(true);
      }
    }
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

  const packs: [string, PlacePack][] = Object.entries(PLACE_PACKS);

  /**
   * The place packs — one country's address book each, and the reason a workspace in Ohio is not
   * shown Ottawa ward names.
   *
   * A dataset names a household by site key alone, so every pack must carry every key or a story
   * silently loses its address. These checks are also what proves the seeded boundary polygons are
   * usable: a turf may not span two areas, and that only holds if each area's outline contains its
   * own households and nobody else's.
   */
  describe('place packs', () => {
    it('carry the same site keys in the same order', () => {
      const [firstName, first] = packs[0] ?? [];
      expect(first, 'there is at least one place pack').toBeDefined();
      if (!first || !firstName) return;
      const expected = first.sites.map((s) => s.key);
      expect(new Set(expected).size, `${firstName} repeats a site key`).toBe(expected.length);
      for (const [name, pack] of packs) {
        expect(
          pack.sites.map((s) => s.key),
          `${name} does not carry the same site keys as ${firstName}`,
        ).toEqual(expected);
      }
    });

    for (const [name, pack] of packs) {
      describe(name, () => {
        it('files every site under one of its own areas', () => {
          const used = new Set<string>();
          for (const site of pack.sites) {
            expect(DEMO_AREA_KEYS.includes(site.area), `${name} site ${site.key} has area "${site.area}"`).toBe(true);
            used.add(site.area);
          }
          for (const key of DEMO_AREA_KEYS) {
            expect(used.has(key), `${name} area "${key}" has no households, so its turf would be empty`).toBe(true);
          }
        });

        it('gives every area a valid outline within the vertex cap', () => {
          for (const key of DEMO_AREA_KEYS) {
            const geometry = areaGeometry(pack.areas[key]);
            const parsed = boundaryGeometrySchema.safeParse(geometry);
            expect(parsed.success, `${name} area "${key}" is not a valid GeoJSON geometry`).toBe(true);
            expect(countBoundaryVertices(geometry)).toBeLessThanOrEqual(BOUNDARY_MAX_VERTICES_PER_FEATURE);
            const [minLng, minLat, maxLng, maxLat] = boundaryBBoxOf(geometry);
            expect(maxLng, `${name} area "${key}" has an empty bounding box`).toBeGreaterThan(minLng);
            expect(maxLat, `${name} area "${key}" has an empty bounding box`).toBeGreaterThan(minLat);
          }
        });

        /**
         * Seat areas tile a city; they do not overlap. The product's own boundary validation
         * flags overlapping features, so the sample map must not ship one (Ottawa once did, in a
         * sliver between Somerset and Rideau-Vanier that held no household — invisible to the
         * containment test below). Every ring here is an axis-aligned rectangle from `box()`, so
         * bounding boxes ARE the polygons and this check is exact: sharing an edge is fine,
         * sharing any area is not.
         */
        it('keeps every two area outlines from overlapping', () => {
          for (const [i, a] of DEMO_AREA_KEYS.entries()) {
            for (const b of DEMO_AREA_KEYS.slice(i + 1)) {
              const [aMinLng, aMinLat, aMaxLng, aMaxLat] = boundaryBBoxOf(areaGeometry(pack.areas[a]));
              const [bMinLng, bMinLat, bMaxLng, bMaxLat] = boundaryBBoxOf(areaGeometry(pack.areas[b]));
              const lngOverlap = Math.min(aMaxLng, bMaxLng) - Math.max(aMinLng, bMinLng);
              const latOverlap = Math.min(aMaxLat, bMaxLat) - Math.max(aMinLat, bMinLat);
              expect(lngOverlap > 0 && latOverlap > 0, `${name} areas "${a}" and "${b}" overlap`).toBe(false);
            }
          }
        });

        /**
         * The whole point of seeding polygons: a household must land in its own area and in no
         * other, or the seeded `household_districts` row and what the map shows disagree, and a
         * later re-match would move the household to a different turf.
         */
        it('puts every household inside its own area outline and no other', () => {
          for (const site of pack.sites) {
            const inside = DEMO_AREA_KEYS.filter((key) => {
              const geometry = areaGeometry(pack.areas[key]);
              return isPointInPolygon(site.lng, site.lat, geometry.coordinates);
            });
            expect(inside, `${name} site ${site.key} falls inside areas [${inside.join(', ')}]`).toEqual([site.area]);
          }
        });

        it('states a real office whose region belongs to its country', () => {
          const office = pack.office;
          expect(isJurisdictionId(office.jurisdiction), `${name} jurisdiction "${office.jurisdiction}"`).toBe(true);
          if (!isJurisdictionId(office.jurisdiction)) return;
          const spec = JURISDICTIONS[office.jurisdiction];
          expect(spec.country, `${name} office jurisdiction is not in the pack's country`).toBe(pack.country);
          if (spec.requiresRegion) {
            const regions = regionsForCountry(spec.country).map((r) => r.code);
            expect(
              regions,
              `${name} office region "${office.office_region}" is not a ${spec.country} region`,
            ).toContain(office.office_region);
          }
          if (spec.requiresLocality) {
            expect(office.office_locality, `${name} office needs a locality`).toBeTruthy();
          }
          if (office.seat_type === 'district') {
            expect(office.seat_name, `${name} office is a district seat, so it needs a seat name`).toBeTruthy();
          } else {
            expect(office.seat_name, `${name} office is at large, so it has no seat area to name`).toBeNull();
          }
        });

        it('names every venue and gives every route start real coordinates', () => {
          for (const key of DEMO_VENUE_KEYS) {
            expect(pack.venues[key].line1.length, `${name} venue "${key}" has no street address`).toBeGreaterThan(0);
            expect(pack.venues[key].zip.length, `${name} venue "${key}" has no postal code`).toBeGreaterThan(0);
          }
          for (const key of DEMO_ROUTE_START_KEYS) {
            const start = pack.routeStarts[key];
            expect(Number.isFinite(start.lat), `${name} route start "${key}" has no latitude`).toBe(true);
            expect(Number.isFinite(start.lng), `${name} route start "${key}" has no longitude`).toBe(true);
          }
        });

        it('uses its own area code and the fictional 555-01XX block on every demo phone number', () => {
          for (const site of pack.sites) {
            if (site.home_phone == null) continue;
            expect(site.home_phone.startsWith(`${pack.phoneAreaCode}-`), `${name} site ${site.key} phone`).toBe(true);
            // Same reserved-for-fiction rule as the persons test above (REVIEW7 C5).
            expect(/-555-01\d\d$/.test(site.home_phone), `${name} site ${site.key} phone ${site.home_phone}`).toBe(
              true,
            );
          }
        });
      });
    }
  });

  /**
   * Turf cutting over the seeded demo data, run through the real engine rather than a copy of it.
   *
   * The engine refuses to let one turf span two boundaries. That guarantee is only worth anything
   * if the demo's own doors carry the boundary names the seeded polygons would give them, so this
   * feeds the engine exactly what the seeder writes and checks the result.
   */
  describe('turf cutting over the demo data', () => {
    const withTurfs = seeded.filter(([, dataset]) => dataset.turfs.length > 0);

    it('has at least one dataset with turfs to check', () => {
      expect(withTurfs.length).toBeGreaterThan(0);
    });

    for (const [mode, dataset] of withTurfs) {
      for (const [name, pack] of packs) {
        it(`${mode} in ${name}: every pre-cut turf sits in one area`, () => {
          const areaOf = new Map(pack.sites.map((s) => [s.key, s.area]));
          for (const turf of dataset.turfs) {
            expect(turf.households.length, `${mode} turf ${turf.key} has no doors`).toBeGreaterThan(0);
            // The turf's door list IS its streets: the seeder names the turf from `streets`, so a
            // door from an unlisted street would walk under the wrong name.
            expect(turf.households, `${mode} turf ${turf.key} doors are not exactly its streets' houses`).toEqual(
              housesOn(...turf.streets),
            );
            for (const key of turf.households) {
              expect(areaOf.get(key), `${mode} turf ${turf.key} door ${key} is not in area "${turf.area}"`).toBe(
                turf.area,
              );
            }
          }
        });

        it(`${mode} in ${name}: a fresh cut never spans two areas`, () => {
          const doors = dataset.households.flatMap((h) => {
            const site = pack.sites.find((s) => s.key === h.key);
            if (!site) return [];
            return [
              {
                household_id: h.key,
                lat: site.lat,
                lng: site.lng,
                boundaryName: pack.areas[site.area].name,
              },
            ];
          });
          const plan = cutTurfs(doors, 4);
          expect(plan.unplaced, `${mode} in ${name} has doors with no coordinates`).toHaveLength(0);
          expect(plan.placedCount).toBe(doors.length);
          expect(plan.turfs.length).toBeGreaterThan(0);

          const areaNameOf = new Map(doors.map((d) => [d.household_id, d.boundaryName]));
          for (const cluster of plan.turfs) {
            const names = new Set(cluster.households.map((id) => areaNameOf.get(id)));
            expect(names.size, `a cut turf spans areas [${[...names].join(', ')}]`).toBe(1);
            expect([...names][0]).toBe(cluster.boundaryName);
          }
        });
      }
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
       * Task and email assignees are the one reference the seeder resolves with `?? null`: a key
       * that matches no teammate lands the row UNASSIGNED instead of failing. That is the right
       * behaviour at runtime and a silent hole at authoring time — a mistyped assignee looks
       * exactly like a message nobody has triaged yet, which is a state the inbox deliberately
       * also contains. Nothing else would catch it.
       */
      it('assigns work only to teammates this mode actually seeds', () => {
        const users = new Set(dataset.users.map((u) => u.key));
        const assignees: [string, string][] = [
          ...dataset.tasks.flatMap((t): [string, string][] =>
            t.assignToUser ? [[`task "${t.name}"`, t.assignToUser]] : [],
          ),
          // 'owner' is the person who signed up, not a seeded teammate.
          ...dataset.emails.flatMap((e): [string, string][] =>
            e.assignTo && e.assignTo !== 'owner' ? [[`email "${e.subject}"`, e.assignTo]] : [],
          ),
        ];
        for (const [where, key] of assignees) {
          expect(users.has(key), `${where} is assigned to unknown teammate "${key}"`).toBe(true);
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
