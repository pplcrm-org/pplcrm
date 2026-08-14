import { sql } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import {
  POSITION_MAX_ACCURACY_M,
  SHIFT_STALE_CLOSE_MS,
  distanceIncrementM,
} from '../../../../../../../libs/common/src';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { Selectable, Transaction } from 'kysely';

/** One shift row as every reader consumes it (ids stringified, dates as Dates). */
export interface ShiftRow {
  id: string;
  turf_id: string;
  campaign_id: string | null;
  volunteer_person_id: string;
  canvasser_name: string;
  started_at: Date;
  last_activity_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  location_state: 'unknown' | 'sharing' | 'off';
  distance_walked_m: number;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy_m: number | null;
  last_ping_at: Date | null;
}

/** A stored ping, already filtered to display-usable accuracy where the caller asked. */
export interface PingRow {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  received_at: Date;
}

function toLocationState(value: unknown): ShiftRow['location_state'] {
  return value === 'sharing' || value === 'off' ? value : 'unknown';
}

function toShiftRow(r: Selectable<Models['canvass_shifts']>): ShiftRow {
  return {
    id: String(r.id),
    turf_id: String(r.turf_id),
    campaign_id: r.campaign_id != null ? String(r.campaign_id) : null,
    volunteer_person_id: String(r.volunteer_person_id),
    canvasser_name: String(r.canvasser_name),
    started_at: new Date(r.started_at),
    last_activity_at: new Date(r.last_activity_at),
    ended_at: r.ended_at != null ? new Date(r.ended_at) : null,
    end_reason: r.end_reason != null ? String(r.end_reason) : null,
    location_state: toLocationState(r.location_state),
    distance_walked_m: Number(r.distance_walked_m ?? 0),
    last_lat: r.last_lat != null ? Number(r.last_lat) : null,
    last_lng: r.last_lng != null ? Number(r.last_lng) : null,
    last_accuracy_m: r.last_accuracy_m != null ? Number(r.last_accuracy_m) : null,
    last_ping_at: r.last_ping_at != null ? new Date(r.last_ping_at) : null,
  };
}

/**
 * Canvassing shifts and their location pings (the Live tab).
 *
 * Lifecycle rules live HERE so every caller closes a shift the same way:
 * - a shift with no activity for SHIFT_STALE_CLOSE_MS closes with ended_at = its LAST
 *   ACTIVITY, never the moment we noticed (a phone that died at 6:41 reads "ended 6:41");
 * - `ensureOpenShift` never resumes a stale or other-turf shift — it closes it and opens
 *   a fresh one, so one row is always one continuous walking session on one turf.
 *
 * Coordinates are today-only by contract: nothing here may copy a ping into longer-lived
 * storage, and the purge job (`purge_canvass_pings`) deletes the rows nightly.
 */
export class CanvassShiftsRepo extends BaseRepository<'canvass_shifts'> {
  constructor() {
    super('canvass_shifts');
  }

  /**
   * Close open shifts that went quiet, with ended_at = their last activity. Called by
   * every reader before it trusts `ended_at IS NULL`, so "open" always means "active
   * within the last 30 minutes" without a scheduler in the loop.
   */
  public async closeStale(tenant_id: string, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ ended_at: sql`last_activity_at`, end_reason: 'timeout' })
      .where('tenant_id', '=', tenant_id)
      .where('ended_at', 'is', null)
      .where('last_activity_at', '<', new Date(Date.now() - SHIFT_STALE_CLOSE_MS))
      .execute();
  }

  /**
   * The volunteer's open shift on this turf — creating it, and closing any other open
   * shift they hold, so a volunteer is never "out" in two places.
   */
  public async ensureOpenShift(
    input: {
      tenant_id: string;
      turf_id: string;
      campaign_id: string | null;
      volunteer_person_id: string;
      canvasser_name: string;
    },
    trx?: Transaction<Models>,
  ): Promise<ShiftRow> {
    const now = new Date();
    const open = await this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('volunteer_person_id', '=', input.volunteer_person_id)
      .where('ended_at', 'is', null)
      .orderBy('started_at', 'desc')
      .executeTakeFirst();

    if (open) {
      const row = toShiftRow(open);
      const stale = now.getTime() - row.last_activity_at.getTime() > SHIFT_STALE_CLOSE_MS;
      if (!stale && row.turf_id === input.turf_id) return row;
      // A stale shift ended at its last activity; an active one on another turf ends now,
      // because switching turfs is itself the volunteer's action.
      await this.getUpdate(trx)
        .set(
          stale
            ? { ended_at: sql`last_activity_at`, end_reason: 'timeout' }
            : { ended_at: now, end_reason: 'switched' },
        )
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', row.id)
        .execute();
    }

    const inserted = await this.getInsert(trx)
      .values({
        tenant_id: input.tenant_id,
        turf_id: input.turf_id,
        campaign_id: input.campaign_id,
        volunteer_person_id: input.volunteer_person_id,
        canvasser_name: input.canvasser_name,
        started_at: now,
        last_activity_at: now,
      } as OperationDataType<'canvass_shifts', 'insert'>)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toShiftRow(inserted);
  }

  /**
   * Store one broadcast and roll the shift forward: last-ping mirror, activity stamp,
   * and the walked-distance accumulator (rules in live-geometry.ts — a segment with bad
   * accuracy or car speed adds nothing).
   */
  public async recordPing(
    input: {
      tenant_id: string;
      shift: ShiftRow;
      lat: number;
      lng: number;
      accuracy_m: number | null;
      recorded_at: Date | null;
    },
    trx?: Transaction<Models>,
  ): Promise<void> {
    const now = new Date();
    const { shift } = input;

    let increment = 0;
    if (shift.last_lat != null && shift.last_lng != null && shift.last_ping_at != null) {
      increment = distanceIncrementM(
        { lat: shift.last_lat, lng: shift.last_lng, accuracy_m: shift.last_accuracy_m, at: shift.last_ping_at },
        { lat: input.lat, lng: input.lng, accuracy_m: input.accuracy_m, at: now },
      );
    }

    const db = trx ?? this.db;
    await db
      .insertInto('canvass_location_pings')
      .values({
        tenant_id: input.tenant_id,
        shift_id: input.shift.id,
        turf_id: input.shift.turf_id,
        volunteer_person_id: input.shift.volunteer_person_id,
        lat: input.lat,
        lng: input.lng,
        accuracy_m: input.accuracy_m,
        recorded_at: input.recorded_at,
      } as OperationDataType<'canvass_location_pings', 'insert'>)
      .execute();

    await this.getUpdate(trx)
      .set({
        last_activity_at: now,
        last_ping_at: now,
        last_lat: input.lat,
        last_lng: input.lng,
        last_accuracy_m: input.accuracy_m,
        location_state: 'sharing',
        distance_walked_m: shift.distance_walked_m + increment,
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', shift.id)
      .execute();
  }

  /** The Companion reported the browser permission is denied. Not activity — just a fact. */
  public async markLocationOff(
    input: { tenant_id: string; shift_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ location_state: 'off' })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.shift_id)
      .execute();
  }

  /** A knock batch arrived — the shift is alive even if no coordinate ever is. */
  public async touchActivity(input: { tenant_id: string; shift_id: string }, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ last_activity_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.shift_id)
      .execute();
  }

  /** The volunteer tapped Finish. Closes every open shift they hold, ended now. */
  public async finishForVolunteer(
    input: { tenant_id: string; volunteer_person_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ ended_at: new Date(), end_reason: 'finished' })
      .where('tenant_id', '=', input.tenant_id)
      .where('volunteer_person_id', '=', input.volunteer_person_id)
      .where('ended_at', 'is', null)
      .execute();
  }

  /** Every open shift in the workspace (call `closeStale` first). Newest ping first. */
  public async openShifts(tenant_id: string, trx?: Transaction<Models>): Promise<ShiftRow[]> {
    const rows = await this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', tenant_id)
      .where('ended_at', 'is', null)
      .orderBy(sql`last_ping_at DESC NULLS LAST`)
      .execute();
    return rows.map(toShiftRow);
  }

  /** Closed shifts that ended since `since` (the "Wrapped up today" group), newest first. */
  public async wrappedSince(input: { tenant_id: string; since: Date }, trx?: Transaction<Models>): Promise<ShiftRow[]> {
    const rows = await this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('ended_at', 'is not', null)
      .where('ended_at', '>=', input.since)
      .orderBy('ended_at', 'desc')
      .execute();
    return rows.map(toShiftRow);
  }

  /** When the most recent shift ended — the empty state's "last shift ended at 6:41 PM". */
  public async lastEndedAt(tenant_id: string, trx?: Transaction<Models>): Promise<Date | null> {
    const row = await this.getSelect(trx)
      .select(['ended_at'])
      .where('tenant_id', '=', tenant_id)
      .where('ended_at', 'is not', null)
      .orderBy('ended_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.ended_at != null ? new Date(String(row.ended_at)) : null;
  }

  /**
   * One shift's pings in arrival order, filtered to display-usable accuracy
   * (POSITION_MAX_ACCURACY_M; a null accuracy is accepted). Today-only by construction —
   * older rows no longer exist.
   */
  public async pingsForShift(
    input: { tenant_id: string; shift_id: string },
    trx?: Transaction<Models>,
  ): Promise<PingRow[]> {
    const db = trx ?? this.db;
    const rows = await db
      .selectFrom('canvass_location_pings')
      .select(['lat', 'lng', 'accuracy_m', 'received_at'])
      .where('tenant_id', '=', input.tenant_id)
      .where('shift_id', '=', input.shift_id)
      .where((eb) => eb.or([eb('accuracy_m', 'is', null), eb('accuracy_m', '<=', POSITION_MAX_ACCURACY_M)]))
      .orderBy('received_at', 'asc')
      .execute();
    return rows.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      accuracy_m: r.accuracy_m != null ? Number(r.accuracy_m) : null,
      received_at: new Date(String(r.received_at)),
    }));
  }

  /** Midnight close: any shift still open past local midnight ends there. */
  public async closeOpenBefore(input: { tenant_id: string; midnight: Date }, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ ended_at: sql`LEAST(last_activity_at, ${input.midnight})`, end_reason: 'midnight' })
      .where('tenant_id', '=', input.tenant_id)
      .where('ended_at', 'is', null)
      .where('started_at', '<', input.midnight)
      .execute();
  }

  /** Nightly purge: drop yesterday's coordinates for one tenant. Returns rows deleted. */
  public async deletePingsBefore(
    input: { tenant_id: string; cutoff: Date },
    trx?: Transaction<Models>,
  ): Promise<number> {
    const db = trx ?? this.db;
    const result = await db
      .deleteFrom('canvass_location_pings')
      .where('tenant_id', '=', input.tenant_id)
      .where('received_at', '<', input.cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
