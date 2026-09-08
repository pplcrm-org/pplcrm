import type { Transaction } from 'kysely';

import { ADD_FROM_LIST_CAP, DELIVERY_PURPOSE_NOUNS } from '../../../../../../libs/common/src';
import type {
  AddDeliveryRequestType,
  AddDeliveryRequestsFromListType,
  DeliveryPurpose,
  GetSignStatusType,
  IAuthKeyPayload,
  SetDeliveryRequestStatusType,
  TurfDeliveryPurpose,
  UpdateDeliveryRequestType,
  getAllOptionsType,
} from '../../../../../../libs/common/src';

import { ConflictError, NotFoundError } from '../../errors/app-errors';
import { chunk } from '../../lib/chunk';
import { logger } from '../../logger';
import { UserActivityRepo } from '../../lib/user-activity.repo';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
// Repos only, never CanvassingController — the canvassing controller imports THIS one,
// and the repos import nothing above the base layer, so this direction stays cycle-free.
import { TurfAssignmentsRepo } from '../canvassing/repositories/turf-assignments.repo';
import { TurfHouseholdsRepo } from '../canvassing/repositories/turf-households.repo';
// Cycle-safe like the repos above: the lists controller reaches only campaigns, households
// and persons — never this module or canvassing.
import { ListsController } from '../lists/controller';
import { WorkflowsController } from '../workflows/controller';
import { DeliveryRequestsRepo } from './repositories/delivery-requests.repo';

/**
 * The partial unique index enforcing "one open delivery request per household PER PURPOSE"
 "one open delivery request per household PER PURPOSE"
 * (§14; scoped per purpose by the 2026-09-06 turf-modes migration — an open yard-sign request
 * and an open flyer request may coexist on one household, two of the same kind may not).
 */
const OPEN_HOUSEHOLD_UNIQUE_INDEX = 'uq_delivery_requests_open_per_household_purpose';

/** Narrow a DB purpose value; unknown stored values read as the default purpose. */
function asPurpose(value: unknown): DeliveryPurpose {
  return value === 'flyer' ? 'flyer' : 'yard_sign';
}

/**
 * True for the Postgres unique-violation (23505) raised by the open-per-household partial index —
 * the concurrency guard behind the check-then-insert. Constraint-scoped so an unrelated unique
 * violation is never silently swallowed; tolerates a missing constraint name (bare 23505).
 */
function isOpenHouseholdConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  return e.constraint == null || e.constraint === OPEN_HOUSEHOLD_UNIQUE_INDEX;
}

export class DeliveriesController {
  private readonly lists = new ListsController();
  private readonly requestsRepo = new DeliveryRequestsRepo();
  private readonly turfAssignments = new TurfAssignmentsRepo();
  private readonly turfHouseholds = new TurfHouseholdsRepo();
  private readonly campaignsRepo = new CampaignsRepo();
  private readonly userActivity = new UserActivityRepo();

  // ---- Requests -----------------------------------------------------------
  public getAllRequests(tenant: string, options?: getAllOptionsType) {
    return this.requestsRepo.getAllWithCounts({ tenant_id: tenant, options: options as never });
  }

  public getRequestCounts(tenant: string) {
    return this.requestsRepo.getStatusCounts(tenant);
  }

  public getReadyCount(tenant: string) {
    return this.requestsRepo.getReadyCount(tenant);
  }

  // ---- The delivery-turf pool (pointer-column design, 2026-09-06) ---------
  // Called by the canvassing controller; thin pass-throughs so the pool queries
  // live with every other delivery_requests query.

  /** Households with an approved, matching-purpose request nothing is carrying yet. */
  public getPoolHouseholdIds(input: { tenant_id: string; campaign_id: string; purpose: TurfDeliveryPurpose }) {
    return this.requestsRepo.getPoolHouseholdIds(input);
  }

  /** Claim the pool requests behind a cut's doors; returns the households actually won. */
  public claimRequestsForTurf(
    trx: Transaction<Models>,
    input: {
      tenant_id: string;
      campaign_id: string;
      turf_id: string;
      household_ids: string[];
      purpose: TurfDeliveryPurpose;
      user_id: string;
    },
  ) {
    return this.requestsRepo.claimForTurf(trx, input);
  }

  /** Retiring a delivery turf: its undelivered requests fall back into the pool. */
  public releaseTurfPointers(
    input: { tenant_id: string; turf_id: string; user_id: string },
    trx?: Transaction<Models>,
  ) {
    return this.requestsRepo.releaseTurfPointers(input, trx);
  }

  /**
   * Per-door delivery state for one outing's payload: what this turf carries at each
   * household. 'pending' wins over 'undeliverable' (a clean open request means the door
   * is still worth a stop), and 'delivered' only when nothing is open.
   */
  public async turfDeliveryStates(
    tenant_id: string,
    turf_id: string,
  ): Promise<Map<string, 'pending' | 'delivered' | 'undeliverable'>> {
    const rows = await this.requestsRepo.db
      .selectFrom('delivery_requests')
      .select(['household_id', 'status', 'skip_reason'])
      .where('tenant_id', '=', tenant_id)
      .where('turf_id', '=', turf_id)
      .execute();
    const out = new Map<string, 'pending' | 'delivered' | 'undeliverable'>();
    for (const r of rows) {
      const hid = String(r.household_id);
      const open = r.status === 'new' || r.status === 'approved';
      const state: 'pending' | 'delivered' | 'undeliverable' = open
        ? r.skip_reason != null
          ? 'undeliverable'
          : 'pending'
        : 'delivered';
      const prior = out.get(hid);
      if (prior === 'pending') continue;
      if (state === 'pending' || prior == null || prior === 'delivered') out.set(hid, state);
    }
    return out;
  }

  /**
   * The delivery outing's door tap: flip every open request THIS turf carries at the
   * household to delivered, in the op's transaction. Resolution by the pointer, not by
   * purpose — a 'both' outing leaves the sign and the flyer in one visit.
   *
   * 'already_delivered' (this outing's requests are all delivered) is a retried op or a
   * second volunteer at a done door — the world matches what was asked. 'none' means the
   * turf carries nothing here any more (the office declined it mid-shift) and the caller
   * owes the volunteer a rejection, not a success toast.
   */
  public async deliverTurfCarriedRequests(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    input: { turf_id: string; household_id: string; via: string },
  ): Promise<'delivered' | 'already_delivered' | 'none'> {
    const rows = await trx
      .selectFrom('delivery_requests')
      .select(['id', 'purpose', 'status'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('household_id', '=', input.household_id)
      .execute();
    const open = rows.filter((r) => r.status === 'new' || r.status === 'approved');
    if (open.length === 0) return rows.some((r) => r.status === 'delivered') ? 'already_delivered' : 'none';

    const ids = open.map((r) => String(r.id));
    await trx
      .updateTable('delivery_requests')
      .set({ status: 'delivered', skip_reason: null, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', 'in', ids)
      .execute();
    // The sign automation is about signs; a flyer drop must not fire it.
    const signIds = open.filter((r) => r.purpose === 'yard_sign').map((r) => String(r.id));
    await this.triggerSignDeliveredWorkflows(trx, auth.tenant_id, signIds);
    await this.logRequestStanding(trx, auth, ids, 'delivered', input.via);
    return 'delivered';
  }

  /** Undo of the tap above: this outing's delivered requests at the door go back to owed. */
  public async undoTurfCarriedDelivery(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    input: { turf_id: string; household_id: string; via: string },
  ): Promise<boolean> {
    const rows = await trx
      .selectFrom('delivery_requests')
      .select(['id'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('household_id', '=', input.household_id)
      .where('status', '=', 'delivered')
      .execute();
    if (rows.length === 0) return false;
    const ids = rows.map((r) => String(r.id));
    await trx
      .updateTable('delivery_requests')
      .set({ status: 'approved', skip_reason: null, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', 'in', ids)
      .execute();
    await this.logRequestStanding(trx, auth, ids, 'undelivered', input.via);
    return true;
  }

  /**
   * "Couldn't deliver": the reason lands on this outing's open requests at the door.
   * Status stays approved and the pointer stays — the door is still this outing's job
   * and returns to the pool only when the outing retires.
   */
  public async markTurfCarriedUndeliverable(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    input: { turf_id: string; household_id: string; reason: string },
  ): Promise<boolean> {
    const result = await trx
      .updateTable('delivery_requests')
      .set({ skip_reason: input.reason, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('household_id', '=', input.household_id)
      .where('status', 'in', ['new', 'approved'])
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }

  /** Yard-sign standing for one household in one campaign context (household/person pages). */
  public async getSignStatus(auth: IAuthKeyPayload, input: GetSignStatusType) {
    const request = await this.requestsRepo.getSignStatus(auth.tenant_id, input.household_id, input.campaign_id);
    // The open-request guard is per-household across ALL campaigns, but this read is
    // campaign-scoped — so when another campaign holds the open request, say so instead of
    // leaving the UI to offer a create that can only 409 (disclosure over suppression).
    let open_in_other_campaign: { campaign_id: string; campaign_name: string; status: string } | null = null;
    if (!request || request.status === 'declined' || request.status === 'delivered') {
      const open = await this.requestsRepo.getOpenForHousehold(auth.tenant_id, input.household_id, 'yard_sign');
      if (open && open.campaign_id !== String(input.campaign_id)) {
        open_in_other_campaign = {
          campaign_id: open.campaign_id,
          campaign_name: open.campaign_name,
          status: open.status,
        };
      }
    }
    return { request, open_in_other_campaign };
  }

  /** The 409 for "one open request per household per kind", naming purpose + holding campaign. */
  private openHouseholdConflictError(purpose: DeliveryPurpose, open: { campaign_name: string } | null): ConflictError {
    const noun = DELIVERY_PURPOSE_NOUNS[purpose];
    return new ConflictError(
      open
        ? `This household already has an open ${noun} in ${open.campaign_name}.`
        : `This household already has an open ${noun}.`,
    );
  }

  public async addRequest(auth: IAuthKeyPayload, input: AddDeliveryRequestType) {
    const purpose = input.purpose ?? 'yard_sign';
    // Guard: a household with an OPEN request of this kind (new/approved, incl. routed) can't
    // have a second one. A different kind (sign vs flyer) may coexist.
    const open = await this.requestsRepo.getOpenForHousehold(auth.tenant_id, input.household_id, purpose);
    if (open) {
      throw this.openHouseholdConflictError(purpose, open);
    }
    const personId = input.person_id ? String(input.person_id) : null;
    const row = {
      tenant_id: auth.tenant_id,
      // The context this request belongs to (§15); defaults to the office.
      campaign_id: await this.campaignsRepo.resolveForWrite({
        tenant_id: auth.tenant_id,
        campaign_id: input.campaign_id,
      }),
      household_id: input.household_id,
      person_id: personId,
      web_form_id: null,
      source: 'manual',
      status: 'new',
      purpose,
      notes: input.notes ?? null,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    } as OperationDataType<'delivery_requests', 'insert'>;
    let created: { id: string | number };
    try {
      created = await this.requestsRepo.add({ row });
    } catch (err) {
      // The pre-check above is only a fast path: a concurrent create can pass it too and then hit
      // the partial unique index uq_delivery_requests_open_per_household_purpose (23505). Treat
      // the race as exactly what it is — an open request already exists — a 409, never a 500.
      if (isOpenHouseholdConflict(err)) {
        const winner = await this.requestsRepo.getOpenForHousehold(auth.tenant_id, input.household_id, purpose);
        throw this.openHouseholdConflictError(purpose, winner);
      }
      throw err;
    }
    await this.logRequestStanding(undefined, auth, [String(created.id)], 'recorded');
    return { id: String(created.id) };
  }

  /**
   * Bulk targeting intake (§ turfs-absorb-deliveries Phase 2): one APPROVED request per
   * eligible household in a list — the staff-driven path for "flyer this neighbourhood",
   * feeding the delivery-turf pool directly (approved, so cuttable without a second pass).
   *
   * Eligibility, in order:
   *  - a people list contributes each member's household; DNC and deceased members never
   *    become requesters, and a household whose every listed member is barred contributes
   *    nothing. The requester is the lowest-id eligible member (deterministic re-runs).
   *  - a household list contributes its households with no requester; a household whose
   *    every living resident is DNC is skipped (they asked not to hear from us — a
   *    doorstep drop is a message like any other). Empty households pass.
   *  - the tenant's placeholder household never gets a request (no real door).
   *  - households already holding an OPEN request of this purpose are skipped, and the
   *    per-purpose partial index catches any race the pre-check misses (DO NOTHING).
   *  - the batch stops at ADD_FROM_LIST_CAP, reported back as `capped`.
   *
   * Activity: ONE workspace log entry with the counts — deliberately not the per-household
   * standing log, which writes rows one at a time and would turn a 5,000-door intake into
   * 10,000 awaited inserts. The requests themselves carry source 'manual' + created_by.
   */
  public async addRequestsFromList(
    auth: IAuthKeyPayload,
    input: AddDeliveryRequestsFromListType,
  ): Promise<{ created: number; skipped_open: number; skipped_barred: number; capped: boolean }> {
    const campaignId = await this.campaignsRepo.resolveForWrite({
      tenant_id: auth.tenant_id,
      campaign_id: input.campaign_id,
    });
    const members = await this.lists.getCurrentMembers(auth, String(input.list_id));

    const placeholderRow = await this.requestsRepo.db
      .selectFrom('tenants')
      .select('placeholder_household_id')
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    const placeholderId =
      placeholderRow?.placeholder_household_id != null ? String(placeholderRow.placeholder_household_id) : null;

    // household id → requester person id (or null). skippedBarred counts households the
    // DNC/deceased rules removed entirely.
    const requesterByHousehold = new Map<string, string | null>();
    let skippedBarred = 0;

    if (members.object === 'people') {
      const eligibleByHousehold = new Map<string, string>();
      const barredHouseholds = new Set<string>();
      for (const ids of chunk(members.ids)) {
        const rows = await this.requestsRepo.db
          .selectFrom('persons')
          .select(['id', 'household_id', 'do_not_contact', 'deceased_at'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', 'in', ids)
          .execute();
        for (const r of rows) {
          if (r.household_id == null) continue;
          const hid = String(r.household_id);
          if (placeholderId != null && hid === placeholderId) continue;
          if (r.do_not_contact || r.deceased_at != null) {
            barredHouseholds.add(hid);
            continue;
          }
          const pid = String(r.id);
          const prior = eligibleByHousehold.get(hid);
          if (prior == null || Number(pid) < Number(prior)) eligibleByHousehold.set(hid, pid);
        }
      }
      for (const [hid, pid] of eligibleByHousehold) requesterByHousehold.set(hid, pid);
      for (const hid of barredHouseholds) if (!eligibleByHousehold.has(hid)) skippedBarred++;
    } else {
      const candidates = members.ids.map(String).filter((hid) => placeholderId == null || hid !== placeholderId);
      // A household where somebody living is NOT DNC stays; only unanimous DNC skips it.
      // Empty households (nobody living on file) pass — there is still a door.
      const hasLiving = new Set<string>();
      const hasContactable = new Set<string>();
      for (const ids of chunk(candidates)) {
        const rows = await this.requestsRepo.db
          .selectFrom('persons')
          .select(['household_id', 'do_not_contact', 'deceased_at'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('household_id', 'in', ids)
          .execute();
        for (const r of rows) {
          if (r.household_id == null || r.deceased_at != null) continue;
          const hid = String(r.household_id);
          hasLiving.add(hid);
          if (!r.do_not_contact) hasContactable.add(hid);
        }
      }
      for (const hid of candidates) {
        if (hasLiving.has(hid) && !hasContactable.has(hid)) {
          skippedBarred++;
          continue;
        }
        requesterByHousehold.set(hid, null);
      }
    }

    // Skip households already holding an open request of this kind (tenant-wide, like the
    // index). The pre-check keeps the counts honest; the DO NOTHING below wins any race.
    let skippedOpen = 0;
    const householdIds = [...requesterByHousehold.keys()];
    for (const ids of chunk(householdIds)) {
      const rows = await this.requestsRepo.db
        .selectFrom('delivery_requests')
        .select('household_id')
        .where('tenant_id', '=', auth.tenant_id)
        .where('household_id', 'in', ids)
        .where('purpose', '=', input.purpose)
        .where('status', 'in', ['new', 'approved'])
        .execute();
      for (const r of rows) {
        if (requesterByHousehold.delete(String(r.household_id))) skippedOpen++;
      }
    }

    // Deterministic order, then the cap.
    const eligible = [...requesterByHousehold.keys()].sort((a, b) => Number(a) - Number(b));
    const capped = eligible.length > ADD_FROM_LIST_CAP;
    const batch = capped ? eligible.slice(0, ADD_FROM_LIST_CAP) : eligible;

    let created = 0;
    for (const ids of chunk(batch, 1000)) {
      const values = ids.map(
        (hid) =>
          ({
            tenant_id: auth.tenant_id,
            campaign_id: campaignId,
            household_id: hid,
            person_id: requesterByHousehold.get(hid) ?? null,
            web_form_id: null,
            source: 'manual',
            status: 'approved',
            purpose: input.purpose,
            notes: null,
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          }) as OperationDataType<'delivery_requests', 'insert'>,
      );
      const inserted = await this.requestsRepo.db
        .insertInto('delivery_requests')
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .execute();
      created += inserted.length;
      skippedOpen += ids.length - inserted.length;
    }

    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'create',
      entity: 'delivery_request',
      entity_id: String(input.list_id),
      quantity: created,
      metadata: {
        action: 'add_requests_from_list',
        list_id: String(input.list_id),
        purpose: input.purpose,
        created,
        skipped_open: skippedOpen,
        skipped_barred: skippedBarred,
        capped,
      },
    });

    return { created, skipped_open: skippedOpen, skipped_barred: skippedBarred, capped };
  }

  public async updateRequestNotes(auth: IAuthKeyPayload, id: string, input: UpdateDeliveryRequestType) {
    const updated = await this.requestsRepo.update({
      tenant_id: auth.tenant_id,
      id,
      row: { notes: input.notes ?? null, updatedby_id: auth.user_id, updated_at: new Date() } as OperationDataType<
        'delivery_requests',
        'update'
      >,
    });
    if (!updated) throw new NotFoundError('Request not found');
    return { id };
  }

  public async setRequestStatus(auth: IAuthKeyPayload, input: SetDeliveryRequestStatusType) {
    try {
      return await this.doSetRequestStatus(auth, input);
    } catch (err) {
      // Reopening a declined/delivered request (→ new/approved) can collide with the
      // open-per-household index when another campaign already holds the open request.
      if (isOpenHouseholdConflict(err)) {
        const blocked =
          input.ids.length === 1 ? await this.openRequestBlockingReopen(auth.tenant_id, input.ids[0] ?? '') : null;
        throw this.openHouseholdConflictError(blocked?.purpose ?? 'yard_sign', blocked?.open ?? null);
      }
      throw err;
    }
  }

  /** The open same-purpose request on the same household as `requestId` — what a reopen collided with. */
  private async openRequestBlockingReopen(tenantId: string, requestId: string) {
    const row = await this.requestsRepo.db
      .selectFrom('delivery_requests')
      .select(['household_id', 'purpose'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (!row) return null;
    const purpose = asPurpose(row.purpose);
    const open = await this.requestsRepo.getOpenForHousehold(tenantId, String(row.household_id), purpose);
    return { purpose, open };
  }

  private async doSetRequestStatus(auth: IAuthKeyPayload, input: SetDeliveryRequestStatusType) {
    return this.requestsRepo.transaction().execute(async (trx) => {
      const directIds = input.ids;
      if (directIds.length > 0) {
        // The sign_delivered trigger fires only on a genuine transition, so capture which of
        // these rows were not already delivered before the blanket update below.
        let newlyDelivered: string[] = [];
        if (input.status === 'delivered') {
          const notYet = await trx
            .selectFrom('delivery_requests')
            .select(['id'])
            .where('tenant_id', '=', auth.tenant_id)
            .where('id', 'in', directIds)
            .where('status', '!=', 'delivered')
            .execute();
          newlyDelivered = notYet.map((r) => String(r.id));
        }
        // Declining (or reopening to 'new') a request a delivery turf is carrying: clear
        // the pointer — one of its two clear sites — and take the door off the volunteer's
        // list, so nobody drives to deliver a task the office just cancelled. Knock history
        // is kept; removeDoors only unlinks the household from the turf. A manual staff
        // 'delivered' deliberately does neither: the pointer stays as provenance and the
        // door stays on the turf, where the companion shows it as already served.
        if (input.status === 'declined' || input.status === 'new') {
          const carried = await trx
            .selectFrom('delivery_requests')
            .select(['turf_id', 'household_id'])
            .where('tenant_id', '=', auth.tenant_id)
            .where('id', 'in', directIds)
            .where('turf_id', 'is not', null)
            .execute();
          const byTurf = new Map<string, string[]>();
          for (const r of carried) {
            const turfId = String(r.turf_id);
            byTurf.set(turfId, [...(byTurf.get(turfId) ?? []), String(r.household_id)]);
          }
          for (const [turf_id, household_ids] of byTurf) {
            await this.turfHouseholds.removeDoors({ tenant_id: auth.tenant_id, turf_id, household_ids }, trx);
          }
        }
        await trx
          .updateTable('delivery_requests')
          .set({
            status: input.status,
            ...(input.status === 'delivered' ? { skip_reason: null } : {}),
            ...(input.status === 'declined' || input.status === 'new' ? { turf_id: null } : {}),
            updatedby_id: auth.user_id,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', 'in', directIds)
          .execute();
        await this.triggerSignDeliveredWorkflows(trx, auth.tenant_id, newlyDelivered);
      }
      await this.logRequestStanding(trx, auth, input.ids, input.status);
      return { updated: input.ids.length };
    });
  }

  // ---- Called from the Canvass Companion, inside its op transaction -------

  /**
   * A canvasser handed the sign over at the door.
   *
   * Runs inside the caller's transaction so it either happens with the knock or not at all.
   * Two things it must get right:
   *
   * - **It creates the request when there is none**, because a canvasser carrying signs can
   *   hand one to somebody who has never asked. The tenant-wide open-per-household index is
   *   the real guard against a duplicate; a conflict means another campaign is holding this
   *   household's request, and the honest answer there is to do nothing rather than write
   *   into a context this volunteer is not walking.
   * - **It is idempotent.** An already-delivered request returns 'already_delivered' and writes
   *   nothing, so a retried offline op cannot double-log.
   *
   * The two nothing-happened outcomes are distinct on purpose: 'already_delivered' means the
   * world already matches what was asked, but 'other_campaign' means the handover was recorded
   * NOWHERE — the caller owes the volunteer an honest rejection, not a success toast (REVIEW6
   * T2-15). (The old driving-route stop transition is gone with the routes themselves —
   * turfs-absorb-deliveries Phase 4; a delivery-turf pointer, when one carries this request,
   * is untouched here: the turf shows the door as served either way.)
   */
  public async deliverHouseholdSign(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    input: { household_id: string; campaign_id: string; person_id: string | null; via: string },
  ): Promise<'delivered' | 'already_delivered' | 'other_campaign'> {
    const resolution = await this.resolveSignRequestForDelivery(trx, auth, input);
    if (resolution.outcome !== 'ok') return resolution.outcome;
    const requestId = resolution.requestId;

    await trx
      .updateTable('delivery_requests')
      .set({ status: 'delivered', skip_reason: null, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', requestId)
      .execute();
    // resolveSignRequestForDelivery already returned 'already_delivered' for a re-delivery,
    // so reaching here is a genuine transition.
    await this.triggerSignDeliveredWorkflows(trx, auth.tenant_id, [requestId]);
    await this.logRequestStanding(trx, auth, [requestId], 'delivered', input.via);
    return 'delivered';
  }

  /**
   * The canvasser undid it — they hadn't handed the sign over after all.
   *
   * The request returns to the pool as `approved` (somebody did ask for a sign, so it is
   * still owed). A delivery-turf pointer, when one exists, is untouched: whether the door
   * reads "out with the outing" or "ready" follows the pointer, which the turf's retire
   * hook governs.
   */
  public async undoHouseholdSignDelivery(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    input: { household_id: string; campaign_id: string; via: string },
  ): Promise<boolean> {
    const request = await trx
      .selectFrom('delivery_requests')
      .select(['id'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('household_id', '=', input.household_id)
      .where('campaign_id', '=', input.campaign_id)
      // Yard signs only: the canvass door's undo must never find and revert a flyer
      // delivery on the same household — that record belongs to a different task.
      .where('purpose', '=', 'yard_sign')
      .where('status', '=', 'delivered')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    if (!request) return false;
    const requestId = String(request.id);

    await trx
      .updateTable('delivery_requests')
      .set({ status: 'approved', skip_reason: null, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', requestId)
      .execute();
    await this.logRequestStanding(trx, auth, [requestId], 'undelivered', input.via);
    return true;
  }

  /** The request a doorstep delivery should be written against, creating one if needed. */
  private async resolveSignRequestForDelivery(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    input: { household_id: string; campaign_id: string; person_id: string | null },
  ): Promise<{ outcome: 'ok'; requestId: string } | { outcome: 'already_delivered' } | { outcome: 'other_campaign' }> {
    const existing = await trx
      .selectFrom('delivery_requests')
      .select(['id', 'status'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('household_id', '=', input.household_id)
      .where('campaign_id', '=', input.campaign_id)
      // The doorstep handover is a yard sign; a flyer request must be neither reused nor blocked.
      .where('purpose', '=', 'yard_sign')
      .where('status', 'in', ['new', 'approved', 'delivered'])
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    // Already delivered — a retried op, or a second canvasser at the same door.
    if (existing && String(existing.status) === 'delivered') return { outcome: 'already_delivered' };
    if (existing) return { outcome: 'ok', requestId: String(existing.id) };

    const created = await trx
      .insertInto('delivery_requests')
      .values({
        tenant_id: auth.tenant_id,
        campaign_id: input.campaign_id,
        household_id: input.household_id,
        person_id: input.person_id,
        web_form_id: null,
        source: 'canvass',
        status: 'new',
        purpose: 'yard_sign',
        notes: null,
        createdby_id: auth.user_id,
        updatedby_id: auth.user_id,
      })
      // Another campaign holds this household's open request. Writing into that campaign
      // from a turf this volunteer is not walking would be worse than recording nothing.
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    return created?.id != null ? { outcome: 'ok', requestId: String(created.id) } : { outcome: 'other_campaign' };
  }

  /**
   * Campaign archive sweep (§15): an archived campaign is read-only, so its open requests would
   * otherwise hold the one-open-request-per-household slot forever. Retire its delivery turfs,
   * then decline its open requests — all on the caller's (archive) transaction. (The route-cancel
   * half retired with the routes themselves — turfs-absorb-deliveries Phase 4.)
   */
  public async closeCampaignDeliveries(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    campaignId: string,
  ): Promise<{ declined: number; turfsRetired: number }> {
    // An archived (read-only) campaign must not keep volunteers out delivering for it.
    // Retire its delivery turfs, revoke their links, and drop their undelivered requests
    // back into the pool — where the blanket decline below then closes them like every
    // other open request of the campaign.
    const deliveryTurfs = await trx
      .selectFrom('turfs')
      .select(['id'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('campaign_id', '=', campaignId)
      .where('mode', '=', 'delivery')
      .where('status', '!=', 'retired')
      .execute();
    for (const turf of deliveryTurfs) {
      const turfId = String(turf.id);
      await this.turfAssignments.revokeForTurf(
        { tenant_id: auth.tenant_id, turf_id: turfId, user_id: auth.user_id },
        trx,
      );
      await this.requestsRepo.releaseTurfPointers(
        { tenant_id: auth.tenant_id, turf_id: turfId, user_id: auth.user_id },
        trx,
      );
      await trx
        .updateTable('turfs')
        .set({ status: 'retired', updatedby_id: auth.user_id, updated_at: new Date() })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', turfId)
        .execute();
    }

    const openRequestIds = (
      await trx
        .selectFrom('delivery_requests')
        .select(['id'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('campaign_id', '=', campaignId)
        .where('status', 'in', ['new', 'approved'])
        .execute()
    ).map((r) => String(r.id));
    if (openRequestIds.length === 0) {
      return { declined: 0, turfsRetired: deliveryTurfs.length };
    }

    await trx
      .updateTable('delivery_requests')
      // turf_id cleared as a belt over the per-turf release above — a declined request
      // must never read as "out for delivery" whatever carried it.
      .set({ status: 'declined', turf_id: null, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', 'in', openRequestIds)
      .execute();
    await this.logRequestStanding(trx, auth, openRequestIds, 'declined');
    return { declined: openRequestIds.length, turfsRetired: deliveryTurfs.length };
  }

  /**
   * Fire the `sign_delivered` automation trigger for requests that just reached 'delivered'.
   * Enrollment is person-based, so a request without a requester (`person_id` null — e.g. a
   * canvasser planting a sign nobody asked for) enrolls nobody. Runs on the caller's
   * transaction; a workflow failure is logged and never rolls the delivery back.
   */
  private async triggerSignDeliveredWorkflows(
    trx: Transaction<Models>,
    tenantId: string,
    requestIds: string[],
  ): Promise<void> {
    if (requestIds.length === 0) return;
    try {
      const rows = await trx
        .selectFrom('delivery_requests')
        .select(['id', 'person_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', requestIds)
        .execute();
      const workflowsCtrl = new WorkflowsController();
      for (const row of rows) {
        if (row.person_id == null) continue;
        await workflowsCtrl.triggerWorkflow(tenantId, String(row.person_id), 'sign_delivered', null, trx);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to trigger sign_delivered workflows');
    }
  }

  /**
   * Yard-sign standing changes surface on the household's (and requester's) activity feed —
   * the sign lives at the door, so that's where its history belongs (honest attribution, §22.7).
   * Route-level history is logged separately by applyStopTransition/logRouteActivity.
   */
  private async logRequestStanding(
    trx: Transaction<Models> | undefined,
    auth: IAuthKeyPayload,
    requestIds: string[],
    status: 'recorded' | 'undelivered' | SetDeliveryRequestStatusType['status'],
    /** Who did it, when it wasn't staff in the CRM — e.g. "via Canvass Companion (Mai N.)". */
    via = 'staff',
  ): Promise<void> {
    const db = trx ?? this.requestsRepo.db;
    const labels: Record<string, string> = {
      recorded: 'Yard sign request recorded',
      new: 'Yard sign request reopened',
      approved: 'Yard sign request approved',
      declined: 'Yard sign request declined',
      delivered: 'Yard sign marked delivered',
      // The request lands back on 'approved', but "approved" would describe an office
      // decision rather than what happened, which was somebody taking a delivery back.
      undelivered: 'Yard sign delivery undone',
    };
    const message = labels[status] ?? `Yard sign request ${status}`;
    try {
      const rows = await db
        .selectFrom('delivery_requests')
        .select(['id', 'household_id', 'person_id'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', 'in', requestIds)
        .execute();
      for (const r of rows) {
        const targets: Array<{ entity: string; entity_id: string }> = [
          { entity: 'households', entity_id: String(r.household_id) },
        ];
        if (r.person_id != null) targets.push({ entity: 'persons', entity_id: String(r.person_id) });
        for (const target of targets) {
          await this.userActivity.log(
            {
              tenant_id: auth.tenant_id,
              user_id: auth.user_id,
              activity: status === 'recorded' ? 'create' : 'update',
              entity: target.entity,
              entity_id: target.entity_id,
              quantity: 1,
              metadata: {
                action: 'yard_sign_status',
                message,
                entity_label: message,
                request_id: String(r.id),
                via,
              },
            },
            trx,
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to log yard sign standing activity');
    }
  }
}
