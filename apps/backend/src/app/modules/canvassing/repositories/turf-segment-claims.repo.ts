import type { Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

/** A live "I'm on this street" note, as the turf payload hands it to the group. */
export interface LiveSegmentClaim {
  assignment_id: string;
  street_key: string;
  street_label: string;
  canvasser_name: string;
  claimed_at: Date;
}

/**
 * Advisory street claims (§13, group canvassing).
 *
 * The whole point of this repository is what it does NOT do: nothing here is consulted
 * before a knock is accepted, no method refuses a claim because someone else holds the
 * street, and there is no unique index on the street. Two volunteers deciding to work one
 * street together is a legitimate choice. A claim is a message to the rest of the group,
 * and the only thing it is allowed to change is what the street picker says.
 */
export class TurfSegmentClaimsRepo extends BaseRepository<'turf_segment_claims'> {
  constructor() {
    super('turf_segment_claims');
  }

  /**
   * Take a street, releasing whatever this volunteer held first.
   *
   * Release-then-insert rather than an upsert because the partial unique index only covers
   * live rows: releasing first is what makes room, and it keeps the history of where
   * someone has been instead of overwriting it.
   */
  public async claim(
    input: {
      tenant_id: string;
      turf_id: string;
      assignment_id: string;
      volunteer_person_id: string;
      street_key: string;
      street_label: string;
      canvasser_name: string;
      expires_at: Date;
    },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.release(input, trx);
    const row = {
      tenant_id: input.tenant_id,
      turf_id: input.turf_id,
      assignment_id: input.assignment_id,
      volunteer_person_id: input.volunteer_person_id,
      street_key: input.street_key,
      street_label: input.street_label,
      canvasser_name: input.canvasser_name,
      expires_at: input.expires_at,
    } as OperationDataType<'turf_segment_claims', 'insert'>;
    await this.getInsert(trx).values(row).execute();
  }

  /** Hand the street back — "I'm walking the whole turf" or the end of a shift. */
  public async release(
    input: { tenant_id: string; turf_id: string; assignment_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ released_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('assignment_id', '=', input.assignment_id)
      .where('released_at', 'is', null)
      .execute();
  }

  /**
   * Who is on this turf's streets right now.
   *
   * Expiry is filtered here rather than swept by a job: a claim is only ever read on the
   * way into a payload, so an expired row costs nothing until someone cleans it up, and
   * a background sweep would be a moving part with no reader waiting on it.
   */
  public async activeForTurf(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<LiveSegmentClaim[]> {
    const rows = await this.getSelect(trx)
      .select(['assignment_id', 'street_key', 'street_label', 'canvasser_name', 'claimed_at'])
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('released_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('claimed_at', 'asc')
      .execute();
    return rows.map((r) => ({
      assignment_id: String(r.assignment_id),
      street_key: String(r.street_key),
      street_label: String(r.street_label),
      canvasser_name: String(r.canvasser_name),
      claimed_at: new Date(String(r.claimed_at)),
    }));
  }
}
