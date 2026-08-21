import { TRPCError } from '@trpc/server';
import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { BaseController } from '../../lib/base.controller';
import { isRateLimited } from '../../lib/rate-limiter';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { publicOrgName } from '../../lib/public-tenant';
import { logger } from '../../logger';
import { WorkflowsController } from '../workflows/controller';
import { EventsRepo } from './repositories/events.repo';

const DEFAULT_FIELDS = ['first_name', 'last_name', 'email', 'mobile', 'notes'];

// Counters live in the shared swept limiter (lib/rate-limiter) so distinct visitor IPs on this
// public endpoint don't accumulate in-process for the life of the server.
const RSVP_RATE_LIMIT_MAX = 5;
const RSVP_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export class EventsController extends BaseController<'events', EventsRepo> {
  private readonly campaignsRepo = new CampaignsRepo();
  constructor() {
    super(new EventsRepo());
  }

  public async getAllEvents(auth: IAuthKeyPayload, options?: any) {
    return this.getRepo().getAllEventsWithCount({ tenant_id: auth.tenant_id, options });
  }

  public async addEvent(payload: any, auth: IAuthKeyPayload) {
    const existing = await this.getRepo()
      .db.selectFrom('events')
      .select('id')
      .where('tenant_id', '=', auth.tenant_id)
      .where('slug', '=', payload.slug)
      .executeTakeFirst();

    if (existing) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This URL slug is already in use. Please choose a different one.',
      });
    }

    const row = {
      tenant_id: auth.tenant_id,
      // The context this event belongs to (§15); defaults to the office.
      campaign_id: await this.campaignsRepo.resolveForWrite({
        tenant_id: auth.tenant_id,
        campaign_id: payload.campaign_id,
      }),
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      name: payload.name,
      description: payload.description ?? null,
      location_address: payload.location_address ?? null,
      start_time: payload.start_time,
      end_time: payload.end_time,
      capacity: payload.capacity ?? null,
      contact_email: payload.contact_email ?? null,
      contact_phone: payload.contact_phone ?? null,
      slug: payload.slug,
      is_published: payload.is_published ?? false,
      send_reminder: payload.send_reminder ?? true,
      send_registration_confirmation: payload.send_registration_confirmation ?? true,
      // `fields` is a jsonb column but the generated Kysely model types it as `string[]`.
      // node-postgres serializes a raw JS array parameter as a Postgres ARRAY literal
      // (e.g. `{a,b,c}`), which Postgres then rejects as invalid JSON for a jsonb column.
      // Stringifying it first makes node-postgres send plain text, which Postgres casts
      // to jsonb correctly.
      fields: JSON.stringify(payload.fields ?? DEFAULT_FIELDS) as unknown as string[],
    } as OperationDataType<'events', 'insert'>;

    try {
      return await this.add(row);
    } catch (err) {
      if (err instanceof Error && err.message.includes('events_end_after_start_check')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'End date & time must be after the start date & time.' });
      }
      throw err;
    }
  }

  /**
   * Public registration-page lookup. Tenant-scoped: event slugs are only unique per tenant, and the
   * tenant is resolved from the subdomain (lib/public-tenant) before any event query runs.
   */
  public async getEventBySlug(tenantId: string, slug: string) {
    return this.getRepo()
      .db.selectFrom('events')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('slug', '=', slug)
      .where('is_published', '=', true)
      .executeTakeFirst();
  }

  /**
   * Everything the public /e/:slug SPA page renders, in one payload: the event, its ticket types,
   * live capacity, and the org name. Unpublished/unknown slugs throw NOT_FOUND.
   */
  public async getPublicEventConfig(tenantId: string, slug: string) {
    const event = await this.getEventBySlug(tenantId, slug);
    if (!event) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
    }

    const eventId = String(event.id);
    const [orgName, tickets, regCount] = await Promise.all([
      publicOrgName(tenantId),
      this.getTicketTypesByEventId(eventId, tenantId),
      this.getRegistrationCountForEvent(eventId, tenantId),
    ]);

    const now = new Date();
    const isPast = new Date(event.end_time) < now;
    const isFull = event.capacity !== null && regCount >= event.capacity;
    const remaining = event.capacity !== null ? Math.max(0, event.capacity - regCount) : null;

    const fields: string[] = Array.isArray(event.fields)
      ? event.fields
      : typeof event.fields === 'string'
        ? JSON.parse(event.fields)
        : ['first_name', 'last_name', 'email', 'mobile', 'notes'];

    return {
      orgName,
      event: {
        name: String(event.name),
        description: event.description ?? null,
        location_address: event.location_address ?? null,
        start_time: event.start_time,
        end_time: event.end_time,
        capacity: event.capacity ?? null,
        contact_email: event.contact_email ?? null,
        contact_phone: event.contact_phone ?? null,
        fields,
      },
      tickets: tickets.map((t) => ({
        name: String(t.name),
        description: t.description ?? null,
        price_cents: t.price_cents ?? null,
        capacity: t.capacity ?? null,
      })),
      isPast,
      isFull,
      remaining,
    };
  }

  public async getRegistrationCountForEvent(eventId: string, tenantId: string): Promise<number> {
    const row = await this.getRepo()
      .db.selectFrom('event_registrations')
      .select(({ fn }) => [fn.count('id').as('cnt')])
      .where('tenant_id', '=', tenantId)
      .where('event_id', '=', eventId)
      .where('status', '!=', 'cancelled')
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  public async getTicketTypesByEventId(eventId: string, tenantId: string) {
    return this.getRepo()
      .db.selectFrom('event_ticket_types')
      .selectAll()
      .where('event_id', '=', eventId)
      .where('tenant_id', '=', tenantId)
      .orderBy('sort_order', 'asc')
      .execute();
  }

  public async checkSlugUnique(slug: string, excludeId: string | null, auth: IAuthKeyPayload) {
    if (!slug) return { unique: true };
    let query = this.getRepo()
      .db.selectFrom('events')
      .select('id')
      .where('tenant_id', '=', auth.tenant_id)
      .where('slug', '=', slug);
    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }
    const existing = await query.executeTakeFirst();
    return { unique: !existing };
  }

  public async updateEvent(id: string, payload: any, auth: IAuthKeyPayload) {
    if (payload.slug) {
      const existing = await this.getRepo()
        .db.selectFrom('events')
        .select('id')
        .where('tenant_id', '=', auth.tenant_id)
        .where('slug', '=', payload.slug)
        .where('id', '!=', id)
        .executeTakeFirst();

      if (existing) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This URL slug is already in use. Please choose a different one.',
        });
      }
    }

    const row = {
      ...payload,
      // See addEvent() above: `fields` is jsonb but modeled as `string[]`; stringify so
      // node-postgres sends valid JSON text instead of a Postgres ARRAY literal.
      ...(payload.fields !== undefined ? { fields: JSON.stringify(payload.fields) as unknown as string[] } : {}),
      updatedby_id: auth.user_id,
    } as OperationDataType<'events', 'update'>;
    let result;
    try {
      result = await this.update({ tenant_id: auth.tenant_id, id, row });
    } catch (err) {
      if (err instanceof Error && err.message.includes('events_end_after_start_check')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'End date & time must be after the start date & time.' });
      }
      throw err;
    }

    // Manage pending reminder jobs when the toggle changes
    if (payload.send_reminder === false) {
      try {
        await this.getRepo()
          .db.deleteFrom('background_jobs')
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'pending')
          .where(sql`payload->>'type'`, '=', 'send-event-reminder')
          .where(sql`payload->>'eventId'`, '=', String(id))
          .execute();
      } catch (err) {
        logger.error({ err }, 'Failed to clean up pending event reminders');
      }
    } else if (payload.send_reminder === true) {
      try {
        const event = await this.getRepo()
          .db.selectFrom('events')
          .select(['start_time'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', '=', id)
          .executeTakeFirst();

        if (event) {
          const startMs = new Date(event.start_time).getTime();
          const nowMs = Date.now();
          if (startMs > nowMs) {
            const runAt = new Date(Math.max(nowMs, startMs - 24 * 60 * 60 * 1000));
            const registrations = await this.getRepo()
              .db.selectFrom('event_registrations')
              .select(['id', 'person_id'])
              .where('tenant_id', '=', auth.tenant_id)
              .where('event_id', '=', id)
              .where('status', '=', 'registered')
              .execute();

            for (const reg of registrations) {
              await this.getRepo()
                .db.deleteFrom('background_jobs')
                .where('tenant_id', '=', auth.tenant_id)
                .where('status', '=', 'pending')
                .where(sql`payload->>'type'`, '=', 'send-event-reminder')
                .where(sql`payload->>'registrationId'`, '=', String(reg.id))
                .execute();

              await this.getRepo()
                .db.insertInto('background_jobs')
                .values({
                  tenant_id: auth.tenant_id,
                  queue: 'default',
                  status: 'pending',
                  payload: JSON.stringify({
                    type: 'send-event-reminder',
                    registrationId: String(reg.id),
                    eventId: String(id),
                    personId: String(reg.person_id),
                    tenantId: auth.tenant_id,
                  }),
                  run_at: runAt,
                })
                .execute();
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to re-schedule event reminders');
      }
    }

    return result;
  }

  // Ticket types

  public async getTicketTypesForEvent(event_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getTicketTypesForEvent({ tenant_id: auth.tenant_id, event_id });
  }

  public async addTicketType(payload: any, auth: IAuthKeyPayload) {
    return this.getRepo().addTicketType({
      tenant_id: auth.tenant_id,
      event_id: payload.event_id,
      name: payload.name,
      description: payload.description ?? null,
      price_cents: payload.price_cents ?? 0,
      capacity: payload.capacity ?? null,
      sort_order: payload.sort_order ?? 0,
      user_id: auth.user_id,
    });
  }

  public async updateTicketType(id: string, payload: any, auth: IAuthKeyPayload) {
    return this.getRepo().updateTicketType({ tenant_id: auth.tenant_id, id, row: payload, user_id: auth.user_id });
  }

  public async deleteTicketType(id: string, auth: IAuthKeyPayload) {
    return this.getRepo().deleteTicketType({ tenant_id: auth.tenant_id, id });
  }

  /**
   * Persist the drag-to-reorder of an event's ticket types. `ordered_ids` must be exactly the set of
   * this event's ticket type ids (any foreign or missing id is rejected); each id's sort_order is
   * written to its index so the public /e/:slug page shows tickets in the same order as the form.
   */
  public async reorderTicketTypes(payload: { event_id: string; ordered_ids: string[] }, auth: IAuthKeyPayload) {
    const existing = await this.getRepo().getTicketTypesForEvent({
      tenant_id: auth.tenant_id,
      event_id: payload.event_id,
    });
    const existingIds = new Set(existing.map((t) => String(t.id)));
    const requested = payload.ordered_ids;
    const sameMembers =
      requested.length === existingIds.size &&
      new Set(requested).size === requested.length &&
      requested.every((id) => existingIds.has(id));
    if (!sameMembers) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The new order must list exactly this event’s ticket types.',
      });
    }
    await this.getRepo().reorderTicketTypes({
      tenant_id: auth.tenant_id,
      event_id: payload.event_id,
      ordered_ids: requested,
      user_id: auth.user_id,
    });
    return { reordered: requested.length };
  }

  // Registrations

  public async getRegistrationsForEvent(event_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getRegistrationsForEvent({ tenant_id: auth.tenant_id, event_id });
  }

  public async addRegistration(payload: any, auth: IAuthKeyPayload) {
    // Capacity check across the whole event
    const event = await this.getRepo()
      .db.selectFrom('events')
      .select(['capacity', 'send_reminder', 'send_registration_confirmation', 'start_time', 'name'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', payload.event_id)
      .executeTakeFirst();

    if (!event) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
    }

    if (event.capacity !== null) {
      const countRow = await this.getRepo()
        .db.selectFrom('event_registrations')
        .select(({ fn }) => [fn.count<number>('id').as('cnt')])
        .where('tenant_id', '=', auth.tenant_id)
        .where('event_id', '=', payload.event_id)
        .where('status', '!=', 'cancelled')
        .executeTakeFirst();
      if (Number(countRow?.cnt || 0) >= event.capacity) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This event is at full capacity.' });
      }
    }

    // Per-ticket-type capacity check
    if (payload.ticket_type_id) {
      const ticketType = await this.getRepo()
        .db.selectFrom('event_ticket_types')
        .select(['capacity'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', payload.ticket_type_id)
        .executeTakeFirst();

      if (ticketType && ticketType.capacity !== null) {
        const ticketCountRow = await this.getRepo()
          .db.selectFrom('event_registrations')
          .select(({ fn }) => [fn.count<number>('id').as('cnt')])
          .where('tenant_id', '=', auth.tenant_id)
          .where('ticket_type_id', '=', payload.ticket_type_id)
          .where('status', '!=', 'cancelled')
          .executeTakeFirst();
        if (Number(ticketCountRow?.cnt || 0) >= ticketType.capacity) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'This ticket type is sold out.' });
        }
      }
    }

    const result = await this.getRepo().addRegistration({
      tenant_id: auth.tenant_id,
      event_id: payload.event_id,
      person_id: payload.person_id,
      ticket_type_id: payload.ticket_type_id ?? null,
      status: payload.status ?? 'registered',
      notes: payload.notes ?? null,
      user_id: auth.user_id,
    });

    if (result) {
      // Queue registration confirmation email
      if (event.send_registration_confirmation !== false) {
        try {
          await this.getRepo()
            .db.insertInto('background_jobs')
            .values({
              tenant_id: auth.tenant_id,
              queue: 'default',
              status: 'pending',
              payload: JSON.stringify({
                type: 'send-event-registration-confirmation',
                registrationId: String(result.id),
                eventId: String(payload.event_id),
                personId: String(payload.person_id),
                tenantId: auth.tenant_id,
              }),
              run_at: new Date(),
            })
            .execute();
        } catch (err) {
          logger.error({ err }, 'Failed to queue registration confirmation');
        }
      }

      // Queue 24h reminder
      if (event.send_reminder !== false) {
        try {
          const startMs = new Date(event.start_time).getTime();
          const nowMs = Date.now();
          if (startMs > nowMs) {
            const runAt = new Date(Math.max(nowMs, startMs - 24 * 60 * 60 * 1000));
            await this.getRepo()
              .db.insertInto('background_jobs')
              .values({
                tenant_id: auth.tenant_id,
                queue: 'default',
                status: 'pending',
                payload: JSON.stringify({
                  type: 'send-event-reminder',
                  registrationId: String(result.id),
                  eventId: String(payload.event_id),
                  personId: String(payload.person_id),
                  tenantId: auth.tenant_id,
                }),
                run_at: runAt,
              })
              .execute();
          }
        } catch (err) {
          logger.error({ err }, 'Failed to queue event reminder');
        }
      }

      // Staff-recorded registrations fire the same trigger as public RSVPs. A row created
      // straight into 'cancelled' is not a registration, so it fires nothing.
      if ((payload.status ?? 'registered') !== 'cancelled') {
        try {
          const workflowsCtrl = new WorkflowsController();
          await workflowsCtrl.triggerWorkflow(
            auth.tenant_id,
            String(payload.person_id),
            'event_registered',
            String(payload.event_id),
          );
        } catch (err) {
          logger.error({ err }, 'Failed to trigger event_registered workflow in addRegistration');
        }
      }

      try {
        await this.userActivity.log({
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'assign',
          entity: 'event_registrations',
          entity_id: String(result.id),
          quantity: 1,
          metadata: { id: result.id, event_id: payload.event_id, person_id: payload.person_id },
        });
      } catch (e) {
        logger.error({ err: e }, 'Failed to log registration activity');
      }
    }

    return result;
  }

  public async checkIn(id: string, auth: IAuthKeyPayload) {
    const result = await this.getRepo().updateRegistration({
      tenant_id: auth.tenant_id,
      id,
      row: { status: 'attended', checked_in_at: new Date() },
      user_id: auth.user_id,
    });

    // Cancel pending reminder — they've already arrived
    try {
      await this.getRepo()
        .db.deleteFrom('background_jobs')
        .where('tenant_id', '=', auth.tenant_id)
        .where('status', '=', 'pending')
        .where(sql`payload->>'type'`, '=', 'send-event-reminder')
        .where(sql`payload->>'registrationId'`, '=', String(id))
        .execute();
    } catch (err) {
      logger.error({ err }, 'Failed to cancel event reminder on check-in');
    }

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'event_registrations',
        entity_id: id,
        quantity: 1,
        metadata: { id, status: 'attended', checked_in_at: new Date().toISOString() },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log check-in activity');
    }

    return result;
  }

  public async updateRegistration(id: string, payload: any, auth: IAuthKeyPayload) {
    const result = await this.getRepo().updateRegistration({
      tenant_id: auth.tenant_id,
      id,
      row: payload,
      user_id: auth.user_id,
    });

    // Cancel reminder if status moves away from 'registered'
    if (payload.status && payload.status !== 'registered') {
      try {
        await this.getRepo()
          .db.deleteFrom('background_jobs')
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'pending')
          .where(sql`payload->>'type'`, '=', 'send-event-reminder')
          .where(sql`payload->>'registrationId'`, '=', String(id))
          .execute();
      } catch (err) {
        logger.error({ err }, 'Failed to cancel event reminder on status change');
      }
    }

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'event_registrations',
        entity_id: id,
        quantity: 1,
        metadata: { id, status: payload.status },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log registration update activity');
    }

    return result;
  }

  public async deleteRegistration(id: string, auth: IAuthKeyPayload) {
    const result = await this.getRepo().deleteRegistration({ tenant_id: auth.tenant_id, id });

    if (result) {
      try {
        await this.getRepo()
          .db.deleteFrom('background_jobs')
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'pending')
          .where(sql`payload->>'type'`, '=', 'send-event-reminder')
          .where(sql`payload->>'registrationId'`, '=', String(id))
          .execute();
      } catch (err) {
        logger.error({ err }, 'Failed to cancel event reminder on registration delete');
      }

      try {
        await this.userActivity.log({
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'delete',
          entity: 'event_registrations',
          entity_id: id,
          quantity: 1,
          metadata: { id },
        });
      } catch (e) {
        logger.error({ err: e }, 'Failed to log registration delete activity');
      }
    }

    return result;
  }

  public async getHistoryForPerson(person_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getHistoryForPerson({ tenant_id: auth.tenant_id, person_id });
  }

  public async getEventStats(person_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getEventStats({ tenant_id: auth.tenant_id, person_id });
  }

  public async rsvpPublic(
    tenantId: string,
    slug: string,
    payload: Record<string, string>,
    clientIp: string,
    opts?: { skipIpRateLimit?: boolean },
  ) {
    // Rate limiting. Keyed (workspace-API-key) submissions skip the per-IP window — they come
    // from one integration server and are rate-limited per tenant by the route.
    if (!opts?.skipIpRateLimit) {
      if (isRateLimited(`event-rsvp:${clientIp}`, RSVP_RATE_LIMIT_MAX, RSVP_RATE_LIMIT_WINDOW_MS)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded. Please try again in a minute.',
        });
      }
    }

    const event = await this.getEventBySlug(tenantId, slug);
    if (!event) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
    }

    // Honeypot
    if (payload['_hp'] && payload['_hp'].trim().length > 0) {
      return { success: true };
    }

    const email = payload['email']?.trim();
    if (!email) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Email address is required.' });
    }

    if (new Date(event.end_time) < new Date()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This event has ended and registration is closed.' });
    }

    const firstName = payload['first_name']?.trim() || null;
    const lastName = payload['last_name']?.trim() || null;
    const mobile = payload['mobile']?.trim() || null;
    const notes = payload['notes']?.trim() || null;

    await this.getRepo()
      .transaction()
      .execute(async (trx: Transaction<Models>) => {
        const tenantRow = await trx
          .selectFrom('tenants')
          .select(['placeholder_household_id', 'admin_id'])
          .where('id', '=', tenantId)
          .executeTakeFirst();

        const householdId = tenantRow?.placeholder_household_id;
        const creatorId = tenantRow?.admin_id;

        if (!householdId || !creatorId) {
          throw new Error('Tenant configuration is incomplete.');
        }

        // Check overall capacity
        if (event.capacity !== null) {
          const countRow = await trx
            .selectFrom('event_registrations')
            .select(({ fn }) => [fn.count<number>('id').as('cnt')])
            .where('tenant_id', '=', tenantId)
            .where('event_id', '=', String(event.id))
            .where('status', '!=', 'cancelled')
            .executeTakeFirst();
          if (Number(countRow?.cnt || 0) >= event.capacity) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'This event is at full capacity.' });
          }
        }

        // Find or create person
        const existing = await trx
          .selectFrom('persons')
          .select(['id', 'first_name', 'last_name', 'mobile', 'notes'])
          .where('tenant_id', '=', tenantId)
          .where(sql`lower(email)`, '=', email.toLowerCase())
          .executeTakeFirst();

        let personId: string;

        if (existing) {
          personId = String(existing.id);
          const updateRow: any = { updatedby_id: creatorId, updated_at: sql`now()` };
          if (!existing.first_name && firstName) updateRow.first_name = firstName;
          if (!existing.last_name && lastName) updateRow.last_name = lastName;
          if (!existing.mobile && mobile) updateRow.mobile = mobile;
          if (notes) {
            updateRow.notes = existing.notes ? `${existing.notes}\n\nEvent RSVP notes: ${notes}` : notes;
          }
          if (Object.keys(updateRow).length > 2) {
            await trx
              .updateTable('persons')
              .set(updateRow)
              .where('tenant_id', '=', tenantId)
              .where('id', '=', existing.id)
              .execute();
          }
        } else {
          // `persons.campaign_id` is NOT NULL, so a campaign must be resolved before insert
          // (there is no "campaign-less" person). `persons` also has no address columns
          // (street1/city/state/zip/country live on `households`, not `persons`), so those
          // RSVP fields are intentionally not persisted here.
          const campaignRow = await trx
            .selectFrom('campaigns')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .orderBy('created_at', 'asc')
            .limit(1)
            .executeTakeFirst();

          if (!campaignRow) {
            throw new Error('Tenant configuration is incomplete.');
          }
          const campaignId = String(campaignRow.id);

          const insertRow = {
            tenant_id: tenantId,
            campaign_id: campaignId,
            household_id: householdId,
            createdby_id: creatorId,
            updatedby_id: creatorId,
            first_name: firstName,
            last_name: lastName,
            email,
            mobile,
            notes,
          };

          const insertRes = await trx.insertInto('persons').values(insertRow).returning('id').executeTakeFirstOrThrow();
          personId = String(insertRes.id);

          try {
            const workflowsCtrl = new WorkflowsController();
            await workflowsCtrl.triggerWorkflow(tenantId, personId, 'contact_created', null, trx);
          } catch (err) {
            logger.error({ err }, 'Failed to trigger contact_created workflow in rsvpPublic');
          }
        }

        // Check duplicate registration
        const existingReg = await trx
          .selectFrom('event_registrations')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('event_id', '=', String(event.id))
          .where('person_id', '=', personId)
          .where('status', '!=', 'cancelled')
          .executeTakeFirst();

        if (existingReg) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already registered for this event.' });
        }

        // Insert registration
        const reg = await trx
          .insertInto('event_registrations')
          .values({
            tenant_id: tenantId,
            event_id: String(event.id),
            person_id: personId,
            ticket_type_id: null,
            status: 'registered',
            notes: notes ?? null,
            createdby_id: creatorId,
            updatedby_id: creatorId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        // Unlike contact_created above (new people only), this fires for EVERY registrant —
        // an existing supporter registering is exactly the moment an event follow-up
        // automation exists for.
        try {
          const workflowsCtrl = new WorkflowsController();
          await workflowsCtrl.triggerWorkflow(tenantId, personId, 'event_registered', String(event.id), trx);
        } catch (err) {
          logger.error({ err }, 'Failed to trigger event_registered workflow in rsvpPublic');
        }

        // Queue confirmation email
        if (event.send_registration_confirmation !== false) {
          try {
            await trx
              .insertInto('background_jobs')
              .values({
                tenant_id: tenantId,
                queue: 'default',
                status: 'pending',
                payload: JSON.stringify({
                  type: 'send-event-registration-confirmation',
                  registrationId: String(reg.id),
                  eventId: String(event.id),
                  personId,
                  tenantId,
                }),
                run_at: new Date(),
              })
              .execute();
          } catch (err) {
            logger.error({ err }, 'Failed to queue RSVP confirmation');
          }
        }

        // Queue 24h reminder
        if (event.send_reminder !== false) {
          try {
            const startMs = new Date(event.start_time).getTime();
            const nowMs = Date.now();
            if (startMs > nowMs) {
              const runAt = new Date(Math.max(nowMs, startMs - 24 * 60 * 60 * 1000));
              await trx
                .insertInto('background_jobs')
                .values({
                  tenant_id: tenantId,
                  queue: 'default',
                  status: 'pending',
                  payload: JSON.stringify({
                    type: 'send-event-reminder',
                    registrationId: String(reg.id),
                    eventId: String(event.id),
                    personId,
                    tenantId,
                  }),
                  run_at: runAt,
                })
                .execute();
            }
          } catch (err) {
            logger.error({ err }, 'Failed to queue event reminder in rsvpPublic');
          }
        }
      });

    return { success: true };
  }
}
