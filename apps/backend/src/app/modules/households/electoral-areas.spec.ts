import { sql } from 'kysely';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { electoralAreaSelects, resolveSeatContext, seatStatusForHousehold, seatStatusSelect } from './electoral-areas';
import type { SeatStatus } from './electoral-areas';

function rand() {
  return String(Math.floor(Math.random() * 100000000) + 10000000);
}

/**
 * The grid's own construction, straight out of {@link seatStatusSelect}'s doc comment: a lateral
 * join over `household_districts` feeding the CASE expression the outer SELECT reads. Running the
 * real query — not just calling the function that builds it — is what proves the SQL branches agree
 * with {@link seatStatusForHousehold} rather than merely reading as if they should.
 */
async function seatStatusFromGrid(
  db: any,
  tenantId: string,
  householdId: string,
  seatSetId: string | null,
  seatAreaNames: readonly string[],
  setStampedAt: Date | null,
): Promise<SeatStatus | null> {
  const row = await db
    .selectFrom('households')
    .leftJoinLateral(
      (eb: any) =>
        eb
          .selectFrom('household_districts as hd')
          .whereRef('hd.household_id', '=', 'households.id')
          .whereRef('hd.tenant_id', '=', 'households.tenant_id')
          .select(electoralAreaSelects(seatSetId))
          .as('hd_areas'),
      (join: any) => join.onTrue(),
    )
    .select(() => [seatStatusSelect(seatSetId, seatAreaNames, setStampedAt)])
    .where('households.tenant_id', '=', tenantId)
    .where('households.id', '=', householdId)
    .executeTakeFirst();
  return (row?.seat_status ?? null) as SeatStatus | null;
}

/**
 * The four-way seat-status answer is computed twice on purpose — once as a SQL CASE for grid list
 * queries ({@link seatStatusSelect}), once in TypeScript for a single household on a record page
 * ({@link seatStatusForHousehold}) — because a list query and a one-row lookup cannot share one code
 * path. `electoral-areas.ts` says outright that a grid and a record page disagreeing would be a
 * defect. This suite is what actually checks that: it runs the same household setup through both
 * implementations and asserts they land on the same answer, including the two rules most likely to
 * drift apart silently — case/whitespace-insensitive name matching, and a `boundary_checked_at` that
 * predates the seat set itself.
 */
describe('seat status: grid SQL and household-detail TS agree', () => {
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let seatSetId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant' }).execute();

    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `test-${userId}@example.com`,
        password: 'password',
        first_name: 'Test',
        last_name: 'User',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Test Campaign',
        jurisdiction: 'other',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const set = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug: `seat-${rand()}`,
        label: 'Ridings',
        jurisdiction: 'other',
        role: 'seat_area',
        source: 'drawn',
        createdby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    seatSetId = String(set.id);

    await db
      .insertInto('campaign_areas')
      .values({ tenant_id: tenantId, campaign_id: campaignId, name: 'Milton', createdby_id: userId })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaign_areas').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function createHousehold(): Promise<string> {
    const row = await db
      .insertInto('households')
      .values({ tenant_id: tenantId, campaign_id: campaignId, createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  /**
   * Fixture cases both implementations must classify identically. Each row describes a household
   * setup — its `household_districts` row on the seat set (if any) and its `boundary_checked_at`
   * relative to the set's own stamp — and the one `SeatStatus` both implementations must return.
   */
  const cases: {
    description: string;
    areaName?: string;
    checkedAt?: 'now' | 'before-set-existed';
    expected: SeatStatus;
  }[] = [
    { description: 'inside the wanted area, exact name', areaName: 'Milton', expected: 'in' },
    {
      description: 'inside the wanted area, name differing only by case and whitespace',
      areaName: '  MILTON ',
      expected: 'in',
    },
    { description: 'on the map, in a different area', areaName: 'Halton', expected: 'other' },
    { description: 'off the map, checked after the set was stamped', checkedAt: 'now', expected: 'outside' },
    { description: 'never checked at all', expected: 'unknown' },
    { description: 'checked, but before the seat set existed', checkedAt: 'before-set-existed', expected: 'unknown' },
  ];

  for (const testCase of cases) {
    it(`${testCase.description} → '${testCase.expected}' on both the grid and the record page`, async () => {
      const householdId = await createHousehold();

      if (testCase.areaName != null) {
        await db
          .insertInto('household_districts')
          .values({ tenant_id: tenantId, household_id: householdId, set_id: seatSetId, name: testCase.areaName })
          .execute();
      }

      if (testCase.checkedAt === 'now') {
        await db
          .updateTable('households')
          .set({ boundary_checked_at: sql`now()` })
          .where('id', '=', householdId)
          .execute();
      } else if (testCase.checkedAt === 'before-set-existed') {
        await db
          .updateTable('households')
          .set({ boundary_checked_at: new Date('2000-01-01T00:00:00Z') })
          .where('id', '=', householdId)
          .execute();
      }

      const seat = await resolveSeatContext(db, tenantId, campaignId);
      expect(seat.setId).toBe(seatSetId);
      expect(seat.seatAreaNames).toEqual(['Milton']);

      const gridStatus = await seatStatusFromGrid(
        db,
        tenantId,
        householdId,
        seat.setId,
        seat.seatAreaNames,
        seat.setStampedAt,
      );
      const recordStatus = await seatStatusForHousehold(db, tenantId, householdId, campaignId);

      expect(recordStatus).toBe(testCase.expected);
      expect(gridStatus).toBe(testCase.expected);
      expect(gridStatus).toBe(recordStatus);
    });
  }
});
