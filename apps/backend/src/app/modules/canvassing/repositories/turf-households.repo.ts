import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export interface DoorRow {
  household_id: string;
  street_num: string | null;
  street1: string | null;
  /** Unit/suite. Present so the Companion can fold a building's doors into one row. */
  apt: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  walk_order: number | null;
}

/**
 * One geocoded door with its knock activity inside a window — the raw input to
 * the §13.3 Coverage map. `conversations`/`attempts` are counted over the range;
 * the controller derives the display status (talked / knocked-no-answer / not
 * yet) and the per-turf boundary hull from these rows.
 */
export interface CoverageDoorRow {
  household_id: string;
  turf_id: string;
  turf_name: string;
  ward: string | null;
  lat: number;
  lng: number;
  conversations: number;
  attempts: number;
}

const CONVERSATION = 'conversation';

/** The doors (households) that belong to a turf. */
export class TurfHouseholdsRepo extends BaseRepository<'turf_households'> {
  constructor() {
    super('turf_households');
  }

  public async getHouseholdIds(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    const rows = await this.getSelect(trx)
      .select('household_id')
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .execute();
    return rows.map((r) => String(r.household_id));
  }

  /**
   * `household_ids` arrive in the cutting engine's snake-sweep order, which IS
   * the suggested walk order — each door's position is stored as `walk_order`
   * (appended after any existing doors on refresh).
   */
  public async addDoors(
    input: { tenant_id: string; turf_id: string; household_ids: string[]; user_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    if (input.household_ids.length === 0) return;
    const maxRow = await this.getSelect(trx)
      .select((eb) => eb.fn.max('walk_order').as('max_order'))
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .executeTakeFirst();
    const offset = Number(maxRow?.max_order ?? 0);
    const rows = input.household_ids.map(
      (hid, i) =>
        ({
          tenant_id: input.tenant_id,
          turf_id: input.turf_id,
          household_id: hid,
          walk_order: offset + i + 1,
          createdby_id: input.user_id,
          updatedby_id: input.user_id,
        }) as OperationDataType<'turf_households', 'insert'>,
    );
    await this.getInsert(trx)
      .values(rows)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  public async removeDoors(
    input: { tenant_id: string; turf_id: string; household_ids: string[] },
    trx?: Transaction<Models>,
  ): Promise<void> {
    if (input.household_ids.length === 0) return;
    await this.getDelete(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('household_id', 'in', input.household_ids)
      .execute();
  }

  /** Door list with address + geocode for the Companion and the turf map. */
  public async getDoors(input: { tenant_id: string; turf_id: string }, trx?: Transaction<Models>): Promise<DoorRow[]> {
    const rows = await this.getSelect(trx)
      .innerJoin('households', 'households.id', 'turf_households.household_id')
      .where('turf_households.tenant_id', '=', input.tenant_id)
      .where('turf_households.turf_id', '=', input.turf_id)
      .select([
        'households.id as household_id',
        'households.street_num',
        'households.street1',
        'households.apt',
        'households.city',
        'households.state',
        'households.zip',
        'households.lat',
        'households.lng',
        'turf_households.walk_order',
      ])
      .orderBy(sql`turf_households.walk_order NULLS LAST`)
      .orderBy('households.id')
      .execute();
    return rows.map((r) => ({
      household_id: String(r.household_id),
      street_num: r.street_num ?? null,
      street1: r.street1 ?? null,
      apt: r.apt ?? null,
      city: r.city ?? null,
      state: r.state ?? null,
      zip: r.zip ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      walk_order: r.walk_order == null ? null : Number(r.walk_order),
    }));
  }

  /**
   * Every geocoded door that belongs to a turf, with its knock counts inside the
   * window — one row per door. Doors without coordinates can't be mapped, so
   * they're excluded here (the report's numeric tiles still count them). Knocks
   * are left-joined within the range so an un-knocked door still returns a row
   * (its counts are zero → "not yet knocked" once the controller derives status).
   */
  public async getCoverageRows(
    input: { tenant_id: string; from: Date; to: Date },
    trx?: Transaction<Models>,
  ): Promise<CoverageDoorRow[]> {
    const rows = await this.getSelect(trx)
      .innerJoin('households as h', 'h.id', 'turf_households.household_id')
      .innerJoin('turfs as t', 't.id', 'turf_households.turf_id')
      .leftJoin('turf_knocks as k', (join) =>
        join
          .onRef('k.turf_id', '=', 'turf_households.turf_id')
          .onRef('k.household_id', '=', 'turf_households.household_id')
          .on('k.tenant_id', '=', input.tenant_id)
          .on('k.knocked_at', '>=', input.from)
          .on('k.knocked_at', '<', input.to),
      )
      .where('turf_households.tenant_id', '=', input.tenant_id)
      .where('h.lat', 'is not', null)
      .where('h.lng', 'is not', null)
      .groupBy(['turf_households.household_id', 't.id', 't.name', 'h.ward', 'h.lat', 'h.lng'])
      .select([
        'turf_households.household_id as household_id',
        't.id as turf_id',
        't.name as turf_name',
        'h.ward as ward',
        'h.lat as lat',
        'h.lng as lng',
        sql<number>`COUNT(k.id) FILTER (WHERE k.outcome = ${CONVERSATION})`.as('conversations'),
        sql<number>`COUNT(k.id)`.as('attempts'),
      ])
      .execute();

    return rows.map((r) => ({
      household_id: String(r.household_id),
      turf_id: String(r.turf_id),
      turf_name: String(r.turf_name),
      ward: r.ward ? String(r.ward) : null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      conversations: Number(r.conversations ?? 0),
      attempts: Number(r.attempts ?? 0),
    }));
  }
}
