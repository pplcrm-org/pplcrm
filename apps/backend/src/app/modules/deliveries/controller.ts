import { createHash, randomBytes } from 'crypto';

import type { Transaction } from 'kysely';

import type {
  AddDeliveryRequestType,
  AssignVolunteerType,
  CommitDeliveriesType,
  GetSignStatusType,
  IAuthKeyPayload,
  PlanDeliveriesType,
  ReorderStopType,
  ReorderStopsType,
  SetDeliveryRequestStatusType,
  SetDeliveryRouteStatusType,
  StopActionType,
  UpdateDeliveryRequestType,
  UpdateDeliveryRouteType,
  getAllOptionsType,
} from '../../../../../../libs/common/src';

import { env } from '../../../env';
import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-errors';
import { geocodeAddress } from '../../lib/gis/geocode-address';
import { notifyVolunteerOfLink, type VolunteerLinkSendResult } from '../../lib/mail/volunteer-link-notify';
import { publicOrgName } from '../../lib/public-tenant';
import { legMinutes, roadKm, type LatLng } from '../../lib/routing/geo';
import { planRoutes, type PlanParams, type PlanStopInput } from '../../lib/routing/plan-routes';
import {
  AVG_SPEED_KMH,
  MAX_STOPS_PER_PLAN,
  SERVICE_MINUTES_PER_STOP,
  SHARE_TOKEN_TTL_DAYS,
} from '../../lib/routing/route-constants';
import { UserActivityRepo } from '../../lib/user-activity.repo';
import { volunteerLinksExpire } from '../../lib/volunteer-link-policy';
import { logger } from '../../logger';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { CompanionAccessController } from '../companion-access/controller';
import { DeliveryRequestsRepo } from './repositories/delivery-requests.repo';
import { DeliveryRouteStopsRepo } from './repositories/delivery-route-stops.repo';
import { DeliveryRoutesRepo } from './repositories/delivery-routes.repo';

const ROUTE_DEFAULTS_SETTING_KEY = 'deliveries.route_defaults';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type StopVia = 'staff' | 'volunteer_link';

interface RouteParamsSnapshot {
  serviceMinutes: number;
  avgSpeedKmh: number;
  includeReturnLeg: boolean;
  drivers: number | null;
}

function resolveParams(input: PlanDeliveriesType): PlanParams {
  return {
    serviceMinutes: input.service_minutes ?? SERVICE_MINUTES_PER_STOP,
    avgSpeedKmh: input.avg_speed_kmh ?? AVG_SPEED_KMH,
    includeReturnLeg: input.include_return_leg ?? false,
    drivers: input.drivers ?? null,
  };
}

/** Human-readable route name: "Maple St area — Jul 10" derived from the first stop + today. */
function deriveRouteName(firstAddress: string, date: Date): string {
  const firstSegment = (firstAddress.split(',')[0] ?? '').trim();
  const streetOnly = firstSegment.replace(/^\d+\s+/, '').trim();
  const area = streetOnly || firstSegment || 'Delivery';
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${area} area — ${label}`;
}

/** The partial unique index enforcing "one open delivery request per household" (§14). */
const OPEN_HOUSEHOLD_UNIQUE_INDEX = 'uq_delivery_requests_open_per_household';

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
  private readonly requestsRepo = new DeliveryRequestsRepo();
  private readonly campaignsRepo = new CampaignsRepo();
  private readonly companionAccess = new CompanionAccessController();
  private readonly routesRepo = new DeliveryRoutesRepo();
  private readonly stopsRepo = new DeliveryRouteStopsRepo();
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

  /** Yard-sign standing for one household in one campaign context (household/person pages). */
  public async getSignStatus(auth: IAuthKeyPayload, input: GetSignStatusType) {
    const request = await this.requestsRepo.getSignStatus(auth.tenant_id, input.household_id, input.campaign_id);
    return { request };
  }

  public async addRequest(auth: IAuthKeyPayload, input: AddDeliveryRequestType) {
    // Guard: a household with an OPEN request (new/approved, incl. routed) can't have a second.
    const open = await this.requestsRepo.db
      .selectFrom('delivery_requests')
      .select(['id'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('household_id', '=', input.household_id)
      .where('status', 'in', ['new', 'approved'])
      .executeTakeFirst();
    if (open) {
      throw new ConflictError('This household already has an open delivery request.');
    }
    const personId = input.person_id ? String(input.person_id) : null;
    const row = {
      tenant_id: auth.tenant_id,
      // The context this yard-sign request belongs to (§15); defaults to the office.
      campaign_id: await this.campaignsRepo.resolveForWrite({
        tenant_id: auth.tenant_id,
        campaign_id: input.campaign_id,
      }),
      household_id: input.household_id,
      person_id: personId,
      web_form_id: null,
      source: 'manual',
      status: 'new',
      notes: input.notes ?? null,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    } as OperationDataType<'delivery_requests', 'insert'>;
    let created: { id: string | number };
    try {
      created = await this.requestsRepo.add({ row });
    } catch (err) {
      // The pre-check above is only a fast path: a concurrent create can pass it too and then hit
      // the partial unique index uq_delivery_requests_open_per_household (23505). Treat the race as
      // exactly what it is — an open request already exists — a 409, never an unhandled 500.
      if (isOpenHouseholdConflict(err)) {
        throw new ConflictError('This household already has an open delivery request.');
      }
      throw err;
    }
    await this.logRequestStanding(undefined, auth, [String(created.id)], 'recorded');
    return { id: String(created.id) };
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
    // A request sitting on an active (pending) stop can't be declined or reset out from under a
    // route. Approved + pending stop is the normal on-route state, and 'delivered' flows THROUGH
    // the stop below so route progress stays truthful.
    if (input.status === 'declined' || input.status === 'new') {
      const onRoute = await this.requestsRepo.db
        .selectFrom('delivery_route_stops')
        .select(['id'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('request_id', 'in', input.ids)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (onRoute) {
        throw new BadRequestError('Remove these requests from their route first, or cancel that route.');
      }
    }
    return this.requestsRepo.transaction().execute(async (trx) => {
      let directIds = input.ids;
      if (input.status === 'delivered') {
        // Manual "the sign is in the ground" flip: requests on an active route deliver via their
        // stop (staff-attributed), which also advances/auto-completes the route.
        const pendingStops = await trx
          .selectFrom('delivery_route_stops')
          .select(['id', 'route_id', 'request_id'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('request_id', 'in', input.ids)
          .where('status', '=', 'pending')
          .execute();
        for (const stop of pendingStops) {
          await this.applyStopTransition(trx, auth, String(stop.route_id), String(stop.id), 'deliver', null, 'staff');
        }
        const handled = new Set(pendingStops.map((s) => String(s.request_id)));
        directIds = input.ids.filter((id) => !handled.has(id));
      }
      if (directIds.length > 0) {
        await trx
          .updateTable('delivery_requests')
          .set({
            status: input.status,
            ...(input.status === 'delivered' ? { skip_reason: null } : {}),
            updatedby_id: auth.user_id,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', 'in', directIds)
          .execute();
      }
      await this.logRequestStanding(trx, auth, input.ids, input.status);
      return { updated: input.ids.length };
    });
  }

  // ---- Planning -----------------------------------------------------------
  public async previewPlan(auth: IAuthKeyPayload, input: PlanDeliveriesType) {
    const geo = await geocodeAddress(input.start_address);
    if (!geo) {
      throw new BadRequestError("We couldn't locate that start address. Check it and try again.");
    }
    const start: LatLng = { lat: geo.lat, lng: geo.lng };
    const params = resolveParams(input);

    const eligible = await this.requestsRepo.getEligibleForPlanning(auth.tenant_id, MAX_STOPS_PER_PLAN + 1);
    const capApplied = eligible.length > MAX_STOPS_PER_PLAN;
    const capped = capApplied ? eligible.slice(0, MAX_STOPS_PER_PLAN) : eligible;
    const byId = new Map(capped.map((e) => [e.request_id, e] as const));

    const stops: PlanStopInput[] = capped.map((e) => ({ requestId: e.request_id, lat: e.lat, lng: e.lng }));
    const result = planRoutes(start, stops, params);

    const routes = result.routes.map((route, i) => ({
      index: i + 1,
      total_minutes: route.totalMinutes,
      total_km: route.totalKm,
      stops: route.stops.map((s) => {
        const info = byId.get(s.requestId);
        return {
          request_id: s.requestId,
          seq: s.seq,
          leg_minutes: s.legMinutes,
          address: info?.address ?? '',
          name: info?.name ?? null,
        };
      }),
    }));

    const unroutable = result.unroutable.map((u) => {
      const info = byId.get(u.requestId);
      const reasonText =
        u.reason === 'isolated'
          ? `Isolated. The nearest other stop is ${u.nearestKm} km away`
          : `Too far to reach within an hour from this start (${u.nearestKm} km out)`;
      return { request_id: u.requestId, reason: u.reason, reason_text: reasonText, address: info?.address ?? '' };
    });

    const buckets = await this.requestsRepo.getIneligibleBuckets(auth.tenant_id);

    return {
      start: { address: geo.formatted_address, lat: geo.lat, lng: geo.lng },
      eligible_count: capped.length,
      cap_applied: capApplied,
      routes,
      unroutable,
      ineligible: buckets,
    };
  }

  public async commitPlan(auth: IAuthKeyPayload, input: CommitDeliveriesType) {
    const geo = await geocodeAddress(input.start_address);
    if (!geo) throw new BadRequestError("We couldn't locate that start address. Check it and try again.");
    const start: LatLng = { lat: geo.lat, lng: geo.lng };
    const params = resolveParams(input);
    const snapshot: RouteParamsSnapshot = {
      serviceMinutes: params.serviceMinutes,
      avgSpeedKmh: params.avgSpeedKmh,
      includeReturnLeg: params.includeReturnLeg,
      drivers: params.drivers ?? null,
    };
    const now = new Date();

    return this.routesRepo.transaction().execute(async (trx) => {
      const skipped: Array<{ request_id: string; reason: string }> = [];
      let created = 0;
      let firstRouteId: string | null = null;

      for (const proposed of input.routes) {
        const eligible = await this.requestsRepo.getEligibleByIds(auth.tenant_id, proposed.request_ids, trx);
        const eligibleById = new Map(eligible.map((e) => [e.request_id, e] as const));
        // Preserve the client's order, dropping any request that lost eligibility (concurrent planner).
        const ordered = proposed.request_ids.filter((id) => eligibleById.has(id));
        for (const id of proposed.request_ids) {
          if (!eligibleById.has(id)) skipped.push({ request_id: id, reason: 'no_longer_eligible' });
        }
        if (ordered.length === 0) continue;

        // Recompute legs server-side — never trust client math.
        let cursor: LatLng = start;
        let totalMinutes = 0;
        let totalKm = 0;
        const legs: number[] = [];
        for (const id of ordered) {
          const e = eligibleById.get(id);
          if (!e) continue;
          const point: LatLng = { lat: e.lat, lng: e.lng };
          const leg = legMinutes(cursor, point, params.avgSpeedKmh);
          legs.push(leg);
          totalMinutes += leg + params.serviceMinutes;
          totalKm += roadKm(cursor, point);
          cursor = point;
        }
        if (params.includeReturnLeg) totalKm += roadKm(cursor, start);

        const firstAddress = eligibleById.get(ordered[0] ?? '')?.address ?? '';
        // A route inherits the campaign of the requests it serves (§15); the
        // eligibility query keeps plans single-campaign, so the first stop is
        // representative.
        const firstRequest = await trx
          .selectFrom('delivery_requests')
          .select(['campaign_id'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', '=', String(ordered[0]))
          .executeTakeFirstOrThrow();
        const routeRow = {
          tenant_id: auth.tenant_id,
          campaign_id: String(firstRequest.campaign_id),
          name: deriveRouteName(firstAddress, now),
          status: 'draft',
          volunteer_person_id: null,
          start_address: geo.formatted_address,
          start_lat: start.lat,
          start_lng: start.lng,
          est_minutes: Math.round(totalMinutes * 10) / 10,
          est_km: Math.round(totalKm * 10) / 10,
          scheduled_for: null,
          share_token_hash: null,
          share_token_expires_at: null,
          params: JSON.stringify(snapshot),
          createdby_id: auth.user_id,
          updatedby_id: auth.user_id,
        } as OperationDataType<'delivery_routes', 'insert'>;
        const route = await this.routesRepo.add({ row: routeRow }, trx);
        const routeId = String(route.id);
        if (!firstRouteId) firstRouteId = routeId;

        const stopRows = ordered.map(
          (id, i) =>
            ({
              tenant_id: auth.tenant_id,
              route_id: routeId,
              request_id: id,
              seq: i + 1,
              leg_minutes: Math.round((legs[i] ?? 0) * 10) / 10,
              status: 'pending',
              reason: null,
              acted_at: null,
              acted_via: null,
              createdby_id: auth.user_id,
              updatedby_id: auth.user_id,
            }) as OperationDataType<'delivery_route_stops', 'insert'>,
        );
        await this.stopsRepo.addMany({ rows: stopRows }, trx);
        created++;
        await this.logRouteActivity(trx, auth, routeId, 'create', 'route_created', 'Route created from plan');
      }

      // Persist the start address as the tenant default for the next plan.
      await this.saveRouteDefaults(trx, auth, { start_address: geo.formatted_address });

      return { created, skipped, first_route_id: firstRouteId };
    });
  }

  public async getRouteDefaults(tenant: string): Promise<{ start_address: string | null }> {
    const row = await this.routesRepo.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenant)
      .where('key', '=', ROUTE_DEFAULTS_SETTING_KEY)
      .executeTakeFirst();
    const value = row?.value as { start_address?: string } | null | undefined;
    return { start_address: value?.start_address ?? null };
  }

  private async saveRouteDefaults(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    value: { start_address: string },
  ): Promise<void> {
    await trx
      .insertInto('settings')
      .values({
        tenant_id: auth.tenant_id,
        key: ROUTE_DEFAULTS_SETTING_KEY,
        value: JSON.stringify(value),
        createdby_id: auth.user_id,
        updatedby_id: auth.user_id,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'key']).doUpdateSet({ value: JSON.stringify(value), updatedby_id: auth.user_id }),
      )
      .execute();
  }

  // ---- Routes -------------------------------------------------------------
  public getAllRoutes(tenant: string, options?: getAllOptionsType) {
    return this.routesRepo.getAllWithCounts({ tenant_id: tenant, options: options as never });
  }

  public async getRouteById(auth: IAuthKeyPayload, id: string) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, id);
    if (!route) throw new NotFoundError('Route not found');
    const stops = await this.stopsRepo.getStopsForRoute(auth.tenant_id, id);
    let volunteerName: string | null = null;
    if (route.volunteer_person_id) {
      const v = await this.routesRepo.db
        .selectFrom('persons')
        .select(['first_name', 'last_name'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', String(route.volunteer_person_id))
        .executeTakeFirst();
      if (v) volunteerName = `${v.first_name ?? ''} ${v.last_name ?? ''}`.trim() || null;
    }
    const expiryEnforced = await volunteerLinksExpire(this.routesRepo.db, auth.tenant_id);
    return this.sanitizeRoute(route, stops, volunteerName, expiryEnforced);
  }

  public async updateRoute(auth: IAuthKeyPayload, id: string, input: UpdateDeliveryRouteType) {
    const row: Record<string, unknown> = { updatedby_id: auth.user_id, updated_at: new Date() };
    if (input.name !== undefined) row['name'] = input.name;
    if (input.scheduled_for !== undefined) {
      row['scheduled_for'] = input.scheduled_for ? new Date(input.scheduled_for) : null;
    }
    const updated = await this.routesRepo.update({
      tenant_id: auth.tenant_id,
      id,
      row: row as OperationDataType<'delivery_routes', 'update'>,
    });
    if (!updated) throw new NotFoundError('Route not found');
    return { id };
  }

  public async assignVolunteer(auth: IAuthKeyPayload, input: AssignVolunteerType) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, input.route_id);
    if (!route) throw new NotFoundError('Route not found');
    const personId = input.person_id ? String(input.person_id) : null;
    // Assigning moves draft → assigned; clearing a volunteer on a draft/assigned route → draft.
    let status: 'draft' | 'assigned' | 'in_progress' | 'completed' | 'canceled' = route.status;
    if (personId && status === 'draft') status = 'assigned';
    if (!personId && status === 'assigned') status = 'draft';

    if (!personId) {
      await this.routesRepo.db
        .updateTable('delivery_routes')
        .set({ volunteer_person_id: null, status, updatedby_id: auth.user_id, updated_at: new Date() })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', input.route_id)
        .execute();
      await this.logRouteActivity(
        undefined,
        auth,
        input.route_id,
        'unassign',
        'volunteer_unassigned',
        'Volunteer removed',
      );
      return { id: input.route_id, status, sent: { email: false, sms: false } };
    }

    const person = await this.routesRepo.db
      .selectFrom('persons')
      .select(['first_name', 'email', 'mobile'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', personId)
      .executeTakeFirst();
    if (!person) throw new BadRequestError('Pick the volunteer this route belongs to.');

    // The link is personal, so assignment sends it: mint a fresh token (the raw
    // token is never stored — this is the only moment we can put it in a message)
    // and enqueue the email/SMS in the same transaction as the assignment. A new
    // token also retires any link a previously assigned volunteer still holds.
    const rawToken = randomBytes(32).toString('base64url');
    const url = `${env.companionUrl}/r/${rawToken}`;
    const orgName = await publicOrgName(auth.tenant_id);
    let sent: VolunteerLinkSendResult = { email: false, sms: false };
    await this.routesRepo.transaction().execute(async (trx) => {
      await trx
        .updateTable('delivery_routes')
        .set({
          volunteer_person_id: personId,
          status,
          share_token_hash: createHash('sha256').update(rawToken).digest('hex'),
          share_token_expires_at: new Date(Date.now() + SHARE_TOKEN_TTL_DAYS * MS_PER_DAY),
          updatedby_id: auth.user_id,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', input.route_id)
        .execute();
      sent = await notifyVolunteerOfLink(
        {
          tenant_id: auth.tenant_id,
          person,
          orgName,
          kindLabel: 'delivery route',
          itemName: String(route.name ?? 'Delivery route'),
          url,
        },
        trx,
      );
      await this.logRouteActivity(
        trx,
        auth,
        input.route_id,
        'assign',
        'volunteer_assigned',
        sent.email || sent.sms
          ? `Volunteer assigned — link sent by ${[sent.email ? 'email' : null, sent.sms ? 'text' : null].filter(Boolean).join(' and ')}`
          : 'Volunteer assigned — no contact info on file, link not sent',
      );
    });
    return { id: input.route_id, status, sent };
  }

  /**
   * Re-send the assigned volunteer their personal link (lost email, new phone…).
   * The raw token is never stored, so re-sending means minting a fresh link — the
   * previously sent one stops working, same rule as re-assignment and regenerate.
   */
  public async resendVolunteerLink(auth: IAuthKeyPayload, routeId: string) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, routeId);
    if (!route) throw new NotFoundError('Route not found');
    if (route.volunteer_person_id == null) {
      throw new BadRequestError('Assign a volunteer to this route first. The link is personal.');
    }
    if (route.status === 'canceled' || route.status === 'completed') {
      throw new BadRequestError('This route is over — there is nothing for the volunteer to open.');
    }
    const person = await this.routesRepo.db
      .selectFrom('persons')
      .select(['first_name', 'email', 'mobile'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', String(route.volunteer_person_id))
      .executeTakeFirst();
    if (!person) throw new BadRequestError('The assigned volunteer no longer exists. Assign another volunteer.');

    const rawToken = randomBytes(32).toString('base64url');
    const url = `${env.companionUrl}/r/${rawToken}`;
    const orgName = await publicOrgName(auth.tenant_id);
    let sent: VolunteerLinkSendResult = { email: false, sms: false };
    await this.routesRepo.transaction().execute(async (trx) => {
      await trx
        .updateTable('delivery_routes')
        .set({
          share_token_hash: createHash('sha256').update(rawToken).digest('hex'),
          share_token_expires_at: new Date(Date.now() + SHARE_TOKEN_TTL_DAYS * MS_PER_DAY),
          updatedby_id: auth.user_id,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', routeId)
        .execute();
      sent = await notifyVolunteerOfLink(
        {
          tenant_id: auth.tenant_id,
          person,
          orgName,
          kindLabel: 'delivery route',
          itemName: String(route.name ?? 'Delivery route'),
          url,
        },
        trx,
      );
      if (!sent.email && !sent.sms) {
        // Rolls back the mint: a resend that reaches nobody must not retire the link they already have.
        throw new BadRequestError(
          'This volunteer has no email or mobile on file — add one to their record, or use "Copy volunteer link" to share it yourself.',
        );
      }
      await this.logRouteActivity(
        trx,
        auth,
        routeId,
        'update',
        'link_resent',
        `Volunteer link re-sent by ${[sent.email ? 'email' : null, sent.sms ? 'text' : null].filter(Boolean).join(' and ')}`,
      );
    });
    return { id: routeId, sent };
  }

  public async setRouteStatus(auth: IAuthKeyPayload, input: SetDeliveryRouteStatusType) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, input.route_id);
    if (!route) throw new NotFoundError('Route not found');
    if (input.status === 'canceled') {
      return this.cancelRoute(auth, input.route_id);
    }
    await this.routesRepo.db
      .updateTable('delivery_routes')
      .set({ status: input.status, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', input.route_id)
      .execute();
    return { id: input.route_id, status: input.status };
  }

  private async cancelRoute(auth: IAuthKeyPayload, routeId: string) {
    return this.routesRepo.transaction().execute(async (trx) => {
      // Undelivered (pending) stops return their requests to the pool; delivered stay delivered.
      const pending = await trx
        .selectFrom('delivery_route_stops')
        .select(['id', 'request_id'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('route_id', '=', routeId)
        .where('status', '=', 'pending')
        .execute();
      const requestIds = pending.map((p) => String(p.request_id));
      if (requestIds.length > 0) {
        await trx
          .updateTable('delivery_requests')
          .set({ status: 'approved', updatedby_id: auth.user_id, updated_at: new Date() })
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', 'in', requestIds)
          .execute();
        await trx
          .updateTable('delivery_route_stops')
          .set({ status: 'skipped', reason: 'Other', updatedby_id: auth.user_id, updated_at: new Date() })
          .where('tenant_id', '=', auth.tenant_id)
          .where(
            'id',
            'in',
            pending.map((p) => String(p.id)),
          )
          .execute();
      }
      await trx
        .updateTable('delivery_routes')
        .set({ status: 'canceled', updatedby_id: auth.user_id, updated_at: new Date() })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', routeId)
        .execute();
      await this.logRouteActivity(
        trx,
        auth,
        routeId,
        'update',
        'route_canceled',
        `Route canceled. ${requestIds.length} undelivered stops returned to the pool`,
      );
      return { id: routeId, status: 'canceled' as const, returned: requestIds.length };
    });
  }

  public async deleteRoute(auth: IAuthKeyPayload, id: string) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, id);
    if (!route) throw new NotFoundError('Route not found');
    const status = String(route.status);
    if (status !== 'draft' && status !== 'assigned') {
      throw new BadRequestError('Only draft or assigned routes can be deleted. Cancel the route first.');
    }
    // Stops cascade via FK; requests free automatically once their pending stop is gone.
    await this.routesRepo.delete({ tenant_id: auth.tenant_id, id });
    return { id };
  }

  // ---- Stops (staff) ------------------------------------------------------
  public async stopAction(auth: IAuthKeyPayload, input: StopActionType) {
    if (input.action === 'remove') {
      return this.removeStop(auth, input.route_id, input.stop_id);
    }
    const action = input.action; // narrowed to 'deliver' | 'skip'
    return this.routesRepo.transaction().execute(async (trx) => {
      await this.applyStopTransition(trx, auth, input.route_id, input.stop_id, action, input.reason ?? null, 'staff');
      return this.readRouteProgress(trx, auth.tenant_id, input.route_id);
    });
  }

  private async removeStop(auth: IAuthKeyPayload, routeId: string, stopId: string) {
    return this.routesRepo.transaction().execute(async (trx) => {
      const stop = await trx
        .selectFrom('delivery_route_stops')
        .selectAll()
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', stopId)
        .where('route_id', '=', routeId)
        .executeTakeFirst();
      if (!stop) throw new NotFoundError('Stop not found');
      // Free the request back to the pool then delete the stop and renumber/recompute.
      await trx
        .updateTable('delivery_requests')
        .set({ status: 'approved', updatedby_id: auth.user_id, updated_at: new Date() })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', String(stop.request_id))
        .execute();
      await trx
        .deleteFrom('delivery_route_stops')
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', stopId)
        .execute();
      await this.renumberAndRecompute(trx, auth, routeId);
      await this.logRouteActivity(
        trx,
        auth,
        routeId,
        'update',
        'stop_removed',
        'Stop removed. Request returned to the pool',
      );
      return this.readRouteProgress(trx, auth.tenant_id, routeId);
    });
  }

  /**
   * Drag-to-reorder: reseat only the PENDING stops of a route into the given order. Delivered and
   * skipped stops are not movable — they keep their exact seq, and the pending stops are permuted
   * across the seq slots they already occupy. `ordered_stop_ids` must be exactly the set of the
   * route's pending stop ids (any foreign, non-pending, or missing id is rejected). Seq writes go
   * through `applySeqOrder`'s temp-offset trick to dodge the unique(route_id, seq) index, then legs
   * and the route estimate are recomputed. One `stop_reordered` activity is logged, matching the
   * adjacent-swap path.
   */
  public async reorderStops(auth: IAuthKeyPayload, input: ReorderStopsType) {
    return this.routesRepo.transaction().execute(async (trx) => {
      const route = await trx
        .selectFrom('delivery_routes')
        .select(['id'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', input.route_id)
        .executeTakeFirst();
      if (!route) throw new NotFoundError('Route not found');

      const stops = await trx
        .selectFrom('delivery_route_stops')
        .select(['id', 'seq', 'status'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('route_id', '=', input.route_id)
        .orderBy('seq', 'asc')
        .execute();

      const pendingIds = stops.filter((s) => s.status === 'pending').map((s) => String(s.id));
      const requested = input.ordered_stop_ids;
      // Exact set equality: same length + same members. This one check rejects a foreign/other-route
      // stop, a delivered/skipped id, and a missing pending id all at once.
      const pendingSet = new Set(pendingIds);
      const sameMembers =
        requested.length === pendingIds.length &&
        new Set(requested).size === requested.length &&
        requested.every((id) => pendingSet.has(id));
      if (!sameMembers) {
        throw new BadRequestError('The new order must list exactly the route’s pending stops.');
      }
      if (pendingIds.length < 2) {
        // Nothing to permute — no-op, but return the current authoritative shape.
        return this.readRouteProgress(trx, auth.tenant_id, input.route_id);
      }

      // Drop the pending stops into the slots they currently occupy, in the requested order, while
      // every non-pending stop stays exactly where it is (so it keeps its seq).
      const queue = [...requested];
      const finalOrder = stops.map((s) => (s.status === 'pending' ? (queue.shift() ?? String(s.id)) : String(s.id)));
      await this.applySeqOrder(trx, auth.tenant_id, finalOrder);
      await this.renumberAndRecompute(trx, auth, input.route_id);
      await this.logRouteActivity(trx, auth, input.route_id, 'update', 'stop_reordered', 'Stops reordered');
      return this.readRouteProgress(trx, auth.tenant_id, input.route_id);
    });
  }

  public async reorderStop(auth: IAuthKeyPayload, input: ReorderStopType) {
    return this.routesRepo.transaction().execute(async (trx) => {
      const stops = await trx
        .selectFrom('delivery_route_stops')
        .select(['id', 'seq'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('route_id', '=', input.route_id)
        .orderBy('seq', 'asc')
        .execute();
      const idx = stops.findIndex((s) => String(s.id) === input.stop_id);
      if (idx === -1) throw new NotFoundError('Stop not found');
      const swapIdx = input.direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= stops.length) {
        return this.readRouteProgress(trx, auth.tenant_id, input.route_id);
      }
      const a = stops[idx];
      const b = stops[swapIdx];
      if (!a || !b) return this.readRouteProgress(trx, auth.tenant_id, input.route_id);
      // Swap seq via a temporary value to avoid the unique(route_id, seq) collision.
      await this.setStopSeq(trx, auth.tenant_id, String(a.id), -1);
      await this.setStopSeq(trx, auth.tenant_id, String(b.id), Number(a.seq));
      await this.setStopSeq(trx, auth.tenant_id, String(a.id), Number(b.seq));
      await this.renumberAndRecompute(trx, auth, input.route_id);
      await this.logRouteActivity(trx, auth, input.route_id, 'update', 'stop_reordered', 'Stops reordered');
      return this.readRouteProgress(trx, auth.tenant_id, input.route_id);
    });
  }

  // ---- Share links --------------------------------------------------------
  public async mintShareLink(auth: IAuthKeyPayload, input: { route_id: string; regenerate?: boolean }) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, input.route_id);
    if (!route) throw new NotFoundError('Route not found');
    // The companion access layer verifies the volunteer BEHIND the link, so a
    // link with nobody behind it can never pass the gate — refuse to mint one.
    if (route.volunteer_person_id == null) {
      throw new BadRequestError('Assign a volunteer to this route first. The link is personal.');
    }
    // Whether the 30-day expiry is enforced is a live workspace policy (Workspace → App).
    // The date is always STORED at mint time; the setting decides whether it counts.
    const expiryEnforced = await volunteerLinksExpire(this.routesRepo.db, auth.tenant_id);
    const active =
      route.share_token_hash != null &&
      (!expiryEnforced ||
        (route.share_token_expires_at != null && new Date(route.share_token_expires_at) > new Date()));
    if (active && !input.regenerate) {
      // A live link already exists; the raw token is never stored, so we can't return it. Tell the
      // UI so it can offer copy-vs-regenerate. expires_at is null when the workspace disables expiry.
      return { status: 'exists' as const, expires_at: expiryEnforced ? route.share_token_expires_at : null };
    }
    const rawToken = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_DAYS * MS_PER_DAY);
    await this.routesRepo.db
      .updateTable('delivery_routes')
      .set({
        share_token_hash: hash,
        share_token_expires_at: expiresAt,
        updatedby_id: auth.user_id,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', input.route_id)
      .execute();
    await this.logRouteActivity(undefined, auth, input.route_id, 'update', 'link_created', 'Volunteer link created');
    return { status: 'minted' as const, token: rawToken, expires_at: expiryEnforced ? expiresAt.toISOString() : null };
  }

  public async revokeShareLink(auth: IAuthKeyPayload, routeId: string) {
    const route = await this.routesRepo.getRouteRow(auth.tenant_id, routeId);
    if (!route) throw new NotFoundError('Route not found');
    await this.routesRepo.db
      .updateTable('delivery_routes')
      .set({ share_token_hash: null, share_token_expires_at: null, updatedby_id: auth.user_id, updated_at: new Date() })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', routeId)
      .execute();
    return { id: routeId };
  }

  // ---- Public volunteer path (token is the credential) --------------------
  public hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Resolve a route by token, enforce active/expiry, and return the volunteer-safe payload.
   * The capability token says WHAT may be touched; the companion session (X-Companion-Session)
   * proves WHO is touching it — both are required (COMPANION-APPS-PLAN.md §2).
   */
  public async getPublicRoute(rawToken: string, sessionToken: string | null) {
    const route = await this.routesRepo.findByTokenHash(this.hashToken(rawToken));
    if (!route) return null;
    const expiryEnforced = await volunteerLinksExpire(this.routesRepo.db, String(route.tenant_id));
    if (!this.isTokenUsable(route, expiryEnforced)) return null;
    await this.requireCompanionSession(route, sessionToken);
    const tenantId = String(route.tenant_id);
    const stops = await this.stopsRepo.getStopsForRoute(tenantId, String(route.id));
    const orgName = await publicOrgName(tenantId);
    return this.publicRoutePayload(route, stops, orgName);
  }

  public async publicStopAction(
    rawToken: string,
    stopId: string,
    action: 'deliver' | 'skip' | 'defer' | 'undo',
    reason: string | null,
    sessionToken: string | null,
    opId: string | null,
  ) {
    const route = await this.routesRepo.findByTokenHash(this.hashToken(rawToken));
    if (!route) return null;
    const enforceExpiry = await volunteerLinksExpire(this.routesRepo.db, String(route.tenant_id));
    if (!this.isTokenUsable(route, enforceExpiry)) return null;
    await this.requireCompanionSession(route, sessionToken);
    const tenantId = String(route.tenant_id);
    const routeId = String(route.id);
    const actor: IAuthKeyPayload = {
      tenant_id: tenantId,
      user_id: String(route.createdby_id),
      session_id: 'volunteer-link',
    };
    await this.routesRepo.transaction().execute(async (trx) => {
      // Idempotency ledger (companion_ops, scope 'deliveries'): claim the opId
      // inside the SAME transaction as the action, so claim + apply commit or
      // roll back together. A replayed opId conflicts, applies nothing, and
      // falls through to return the current authoritative payload — this is
      // what makes a retried "defer" move the stop once, not twice.
      if (opId) {
        const claimed = await trx
          .insertInto('companion_ops')
          .values({ tenant_id: tenantId, op_id: opId, scope: 'deliveries' })
          .onConflict((oc) => oc.columns(['tenant_id', 'op_id']).doNothing())
          .returning('op_id')
          .executeTakeFirst();
        if (!claimed) return;
      }
      const stop = await trx
        .selectFrom('delivery_route_stops')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', stopId)
        .where('route_id', '=', routeId)
        .executeTakeFirst();
      if (!stop) throw new NotFoundError('Stop not found');

      if (action === 'defer') {
        await this.deferStop(trx, actor, routeId, stopId);
      } else if (action === 'undo') {
        await this.undoStop(trx, actor, routeId, stopId);
      } else {
        await this.applyStopTransition(trx, actor, routeId, stopId, action, reason, 'volunteer_link');
      }
    });
    const stops = await this.stopsRepo.getStopsForRoute(tenantId, routeId);
    const fresh = await this.routesRepo.getRouteRow(tenantId, routeId);
    const orgName = await publicOrgName(tenantId);
    return fresh ? this.publicRoutePayload(fresh, stops, orgName) : null;
  }

  /**
   * The volunteer-identity gate on every public data request. Throws
   * UnauthorizedError (401 — no/invalid device session, the gate re-verifies)
   * or ForbiddenError (403 — verified but not yet admin-approved); the route
   * handler passes those two statuses through so the companion gate can render
   * its verify/pending states, and keeps the uniform 404 for dead tokens.
   */
  private async requireCompanionSession(
    route: { tenant_id: string } & Record<string, unknown>,
    sessionToken: string | null,
  ): Promise<void> {
    const volunteerId = route['volunteer_person_id'];
    await this.companionAccess.requireSession(sessionToken, {
      tenant_id: String(route.tenant_id),
      volunteer_person_id: volunteerId == null ? null : String(volunteerId),
    });
  }

  // ---- Shared transition helpers ------------------------------------------
  private async applyStopTransition(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    routeId: string,
    stopId: string,
    action: 'deliver' | 'skip',
    reason: string | null,
    via: StopVia,
  ): Promise<void> {
    const stop = await trx
      .selectFrom('delivery_route_stops')
      .selectAll()
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', stopId)
      .where('route_id', '=', routeId)
      .executeTakeFirst();
    if (!stop) throw new NotFoundError('Stop not found');

    const now = new Date();
    if (action === 'deliver') {
      await trx
        .updateTable('delivery_route_stops')
        .set({
          status: 'delivered',
          reason: null,
          acted_at: now,
          acted_via: via,
          updatedby_id: auth.user_id,
          updated_at: now,
        })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', stopId)
        .execute();
      await trx
        .updateTable('delivery_requests')
        .set({ status: 'delivered', skip_reason: null, updatedby_id: auth.user_id, updated_at: now })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', String(stop.request_id))
        .execute();
    } else {
      const skipReason = reason ?? 'Other';
      await trx
        .updateTable('delivery_route_stops')
        .set({
          status: 'skipped',
          reason: skipReason,
          acted_at: now,
          acted_via: via,
          updatedby_id: auth.user_id,
          updated_at: now,
        })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', stopId)
        .execute();
      // A skipped house returns to the planning pool automatically.
      await trx
        .updateTable('delivery_requests')
        .set({ status: 'approved', skip_reason: skipReason, updatedby_id: auth.user_id, updated_at: now })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', String(stop.request_id))
        .execute();
    }

    await this.advanceRouteStatus(trx, auth, routeId, via);
    const message =
      action === 'deliver'
        ? `Stop ${stop.seq} delivered${via === 'volunteer_link' ? ' via volunteer link' : ''}`
        : `Stop ${stop.seq} skipped: ${(reason ?? 'Other').toLowerCase()}${via === 'volunteer_link' ? ' via volunteer link' : ''}`;
    await this.logRouteActivity(
      trx,
      auth,
      routeId,
      'update',
      action === 'deliver' ? 'stop_delivered' : 'stop_skipped',
      message,
      via,
    );
  }

  private async deferStop(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    routeId: string,
    stopId: string,
  ): Promise<void> {
    const stops = await trx
      .selectFrom('delivery_route_stops')
      .select(['id', 'seq', 'status'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('route_id', '=', routeId)
      .orderBy('seq', 'asc')
      .execute();
    const target = stops.find((s) => String(s.id) === stopId);
    if (!target || target.status !== 'pending') return;
    // Move the target to the end: rebuild the order with it last, then renumber via a temp offset.
    const others = stops.filter((s) => String(s.id) !== stopId);
    const newOrder = [...others.map((s) => String(s.id)), stopId];
    await this.applySeqOrder(trx, auth.tenant_id, newOrder);
    await this.renumberAndRecompute(trx, auth, routeId);
    await this.logRouteActivity(
      trx,
      auth,
      routeId,
      'update',
      'stop_deferred',
      'Stop moved to the end of the route',
      'volunteer_link',
    );
  }

  private async undoStop(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    routeId: string,
    stopId: string,
  ): Promise<void> {
    const stop = await trx
      .selectFrom('delivery_route_stops')
      .selectAll()
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', stopId)
      .where('route_id', '=', routeId)
      .executeTakeFirst();
    if (!stop) throw new NotFoundError('Stop not found');
    const now = new Date();
    await trx
      .updateTable('delivery_route_stops')
      .set({
        status: 'pending',
        reason: null,
        acted_at: null,
        acted_via: null,
        updatedby_id: auth.user_id,
        updated_at: now,
      })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', stopId)
      .execute();
    // Restore the request to the pool state (approved) — undo clears the delivered/skipped result.
    await trx
      .updateTable('delivery_requests')
      .set({ status: 'approved', skip_reason: null, updatedby_id: auth.user_id, updated_at: now })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', String(stop.request_id))
      .execute();
    // Undoing from a completed route reopens it to in_progress.
    await trx
      .updateTable('delivery_routes')
      .set({ status: 'in_progress', updatedby_id: auth.user_id, updated_at: now })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', routeId)
      .where('status', '=', 'completed')
      .execute();
    await this.logRouteActivity(trx, auth, routeId, 'update', 'stop_undo', `Stop ${stop.seq} undone`, 'volunteer_link');
  }

  /** First action flips assigned → in_progress; all-terminal auto-completes the route. */
  private async advanceRouteStatus(
    trx: Transaction<Models>,
    auth: IAuthKeyPayload,
    routeId: string,
    _via: StopVia,
  ): Promise<void> {
    const now = new Date();
    const counts = await trx
      .selectFrom('delivery_route_stops')
      .select([
        ({ fn }) => fn.count<number>('id').as('total'),
        ({ fn }) => fn.count<number>('id').filterWhere('status', '=', 'pending').as('pending'),
      ])
      .where('tenant_id', '=', auth.tenant_id)
      .where('route_id', '=', routeId)
      .executeTakeFirst();
    const total = Number(counts?.total ?? 0);
    const pending = Number(counts?.pending ?? 0);
    if (total > 0 && pending === 0) {
      await trx
        .updateTable('delivery_routes')
        .set({ status: 'completed', updatedby_id: auth.user_id, updated_at: now })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', routeId)
        .execute();
      await this.logRouteActivity(
        trx,
        auth,
        routeId,
        'close',
        'route_completed',
        'Route auto-completed: every stop handled',
      );
    } else {
      await trx
        .updateTable('delivery_routes')
        .set({ status: 'in_progress', updatedby_id: auth.user_id, updated_at: now })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', routeId)
        .where('status', 'in', ['assigned', 'draft'])
        .execute();
    }
  }

  private async setStopSeq(trx: Transaction<Models>, tenantId: string, stopId: string, seq: number): Promise<void> {
    await trx
      .updateTable('delivery_route_stops')
      .set({ seq })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', stopId)
      .execute();
  }

  /** Assign contiguous 1..n seq values to the given ordered stop ids, avoiding unique collisions. */
  private async applySeqOrder(trx: Transaction<Models>, tenantId: string, orderedIds: string[]): Promise<void> {
    const OFFSET = 100000;
    for (let i = 0; i < orderedIds.length; i++) {
      await this.setStopSeq(trx, tenantId, orderedIds[i] ?? '', OFFSET + i);
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await this.setStopSeq(trx, tenantId, orderedIds[i] ?? '', i + 1);
    }
  }

  /** Renumber stops to contiguous seq in current order and recompute leg times + route estimate. */
  private async renumberAndRecompute(trx: Transaction<Models>, auth: IAuthKeyPayload, routeId: string): Promise<void> {
    const route = await trx
      .selectFrom('delivery_routes')
      .selectAll()
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', routeId)
      .executeTakeFirst();
    if (!route) return;
    const params = this.paramsFromRoute(route.params);
    const start: LatLng = { lat: Number(route.start_lat), lng: Number(route.start_lng) };
    const stops = await this.stopsRepo.getStopsForRoute(auth.tenant_id, routeId, trx);
    // Ensure contiguous seq.
    await this.applySeqOrder(
      trx,
      auth.tenant_id,
      stops.map((s) => s.id),
    );

    let cursor: LatLng = start;
    let totalMinutes = 0;
    let totalKm = 0;
    for (const stop of stops) {
      const point: LatLng = { lat: stop.lat ?? start.lat, lng: stop.lng ?? start.lng };
      const leg = legMinutes(cursor, point, params.avgSpeedKmh);
      await trx
        .updateTable('delivery_route_stops')
        .set({ leg_minutes: Math.round(leg * 10) / 10 })
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', stop.id)
        .execute();
      totalMinutes += leg + params.serviceMinutes;
      totalKm += roadKm(cursor, point);
      cursor = point;
    }
    if (params.includeReturnLeg && stops.length > 0) totalKm += roadKm(cursor, start);
    await trx
      .updateTable('delivery_routes')
      .set({
        est_minutes: Math.round(totalMinutes * 10) / 10,
        est_km: Math.round(totalKm * 10) / 10,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', routeId)
      .execute();
  }

  private paramsFromRoute(raw: unknown): RouteParamsSnapshot {
    const obj = typeof raw === 'string' ? safeParse(raw) : raw;
    const rec = (obj ?? {}) as Record<string, unknown>;
    return {
      serviceMinutes: typeof rec['serviceMinutes'] === 'number' ? rec['serviceMinutes'] : SERVICE_MINUTES_PER_STOP,
      avgSpeedKmh: typeof rec['avgSpeedKmh'] === 'number' ? rec['avgSpeedKmh'] : AVG_SPEED_KMH,
      includeReturnLeg: rec['includeReturnLeg'] === true,
      drivers: typeof rec['drivers'] === 'number' ? rec['drivers'] : null,
    };
  }

  private async readRouteProgress(trx: Transaction<Models>, tenantId: string, routeId: string) {
    const route = await trx
      .selectFrom('delivery_routes')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', routeId)
      .executeTakeFirst();
    const stops = await this.stopsRepo.getStopsForRoute(tenantId, routeId, trx);
    return {
      id: routeId,
      status: route ? String(route.status) : 'unknown',
      est_minutes: route ? Number(route.est_minutes) : 0,
      est_km: route ? Number(route.est_km) : 0,
      stops,
    };
  }

  /** `enforceExpiry` is the live Workspace → App policy (volunteerLinksExpire) — when the
   * workspace disables expiry, a link stays usable for the life of the route (until revoked
   * or the route is canceled). */
  private isTokenUsable(
    route: { status?: unknown; share_token_expires_at?: unknown } | undefined,
    enforceExpiry: boolean,
  ): route is {
    id: string;
    tenant_id: string;
    createdby_id: string;
    status: string;
    share_token_expires_at: Date | string | null;
  } & Record<string, unknown> {
    if (!route) return false;
    const status = String((route as Record<string, unknown>)['status']);
    if (status === 'canceled') return false;
    if (!enforceExpiry) return true;
    const exp = (route as Record<string, unknown>)['share_token_expires_at'];
    if (!exp) return false;
    return new Date(String(exp)) > new Date();
  }

  private publicRoutePayload(
    route: Record<string, unknown>,
    stops: Awaited<ReturnType<DeliveryRouteStopsRepo['getStopsForRoute']>>,
    orgName: string,
  ) {
    const delivered = stops.filter((s) => s.status === 'delivered').length;
    // Data minimization (spec §4.4): first name + address only. No email/phone/notes/person_id.
    return {
      organization_name: orgName,
      route_name: String(route['name'] ?? 'Delivery route'),
      status: String(route['status'] ?? 'assigned'),
      start: { lat: Number(route['start_lat']), lng: Number(route['start_lng']) },
      stops_total: stops.length,
      stops_delivered: delivered,
      stops: stops.map((s) => ({
        id: s.id,
        seq: s.seq,
        first_name: s.first_name ?? 'Neighbour',
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        status: s.status,
        reason: s.reason,
        acted_at: s.acted_at,
      })),
    };
  }

  private sanitizeRoute(
    route: Record<string, unknown>,
    stops: Awaited<ReturnType<DeliveryRouteStopsRepo['getStopsForRoute']>>,
    volunteerName: string | null,
    expiryEnforced: boolean,
  ) {
    // link_expires_at is a POLICY-shaped value: null when the workspace disables expiry, so the
    // UI never shows a date that won't be enforced.
    const expiresAt = expiryEnforced ? route['share_token_expires_at'] : null;
    const linkActive =
      route['share_token_hash'] != null &&
      (!expiryEnforced || (!!expiresAt && new Date(String(expiresAt)) > new Date()));
    return {
      id: String(route['id']),
      name: String(route['name'] ?? ''),
      status: String(route['status'] ?? 'draft'),
      volunteer_person_id: route['volunteer_person_id'] != null ? String(route['volunteer_person_id']) : null,
      volunteer_name: volunteerName,
      start_address: String(route['start_address'] ?? ''),
      start_lat: Number(route['start_lat']),
      start_lng: Number(route['start_lng']),
      est_minutes: Number(route['est_minutes'] ?? 0),
      est_km: Number(route['est_km'] ?? 0),
      scheduled_for: (route['scheduled_for'] as Date | string | null) ?? null,
      link_active: linkActive,
      link_expires_at: (expiresAt as Date | string | null) ?? null,
      stops,
    };
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
    status: 'recorded' | SetDeliveryRequestStatusType['status'],
  ): Promise<void> {
    const db = trx ?? this.requestsRepo.db;
    const labels: Record<string, string> = {
      recorded: 'Yard sign request recorded',
      new: 'Yard sign request reopened',
      approved: 'Yard sign request approved',
      declined: 'Yard sign request declined',
      delivered: 'Yard sign marked delivered',
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
                via: 'staff',
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

  private async logRouteActivity(
    trxOrAny: Transaction<Models> | unknown,
    auth: IAuthKeyPayload,
    routeId: string,
    activity: 'create' | 'update' | 'assign' | 'unassign' | 'close' | 'reopen' | 'delete',
    action: string,
    message: string,
    via?: StopVia,
  ): Promise<void> {
    const trx = isTransaction(trxOrAny) ? trxOrAny : undefined;
    try {
      await this.userActivity.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity,
          entity: 'delivery_routes',
          entity_id: routeId,
          quantity: 1,
          metadata: { action, message, entity_label: message, via: via ?? 'staff' },
        },
        trx,
      );
    } catch (err) {
      logger.error({ err }, 'Failed to log delivery route activity');
    }
  }
}

function isTransaction(value: unknown): value is Transaction<Models> {
  return typeof value === 'object' && value !== null && 'selectFrom' in (value as Record<string, unknown>);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
