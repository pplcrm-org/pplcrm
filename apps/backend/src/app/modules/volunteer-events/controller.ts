import { BaseController } from '../../lib/base.controller';
import { VolunteerEventsRepo } from './repositories/volunteer-events.repo';
import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import type { AddVolunteerShiftType, UpdateVolunteerShiftType } from '../../../../../../libs/common/src';
import type { OperationDataType, Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type { Transaction, UpdateObject } from 'kysely';
import { sql } from 'kysely';
import { TRPCError } from '@trpc/server';
import { publicOrgName } from '../../lib/public-tenant';
import { WorkflowsController } from '../workflows/controller';
import { logger } from '../../logger';

const DEFAULT_FIELDS = ['first_name', 'last_name', 'email', 'mobile', 'notes'];

const ipSignupTimestamps = new Map<string, number[]>();
const SIGNUP_RATE_LIMIT_MAX = 5;
const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export class VolunteerEventsController extends BaseController<'volunteer_events', VolunteerEventsRepo> {
  constructor() {
    super(new VolunteerEventsRepo());
  }

  public async getAllEvents(auth: IAuthKeyPayload, options?: any) {
    return this.getRepo().getAllEventsWithCount({
      tenant_id: auth.tenant_id,
      options,
    });
  }

  // payload is the pre-coercion wire shape (start_time/end_time arrive as ISO
  // strings from the tRPC boundary, not Date); typing it to the parsed DTO would
  // reject those. Left loose at this coercion boundary — see events/controller.
  public async addEvent(payload: any, auth: IAuthKeyPayload) {
    const existing = await this.getRepo()
      .db.selectFrom('volunteer_events')
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

    if (payload.start_time && payload.end_time && new Date(payload.end_time) <= new Date(payload.start_time)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'End date & time must be after the start date & time.' });
    }

    const row = {
      tenant_id: auth.tenant_id,
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
      is_private: payload.is_private ?? false,
      send_reminder: payload.send_reminder ?? true,
      send_signup_confirmation: payload.send_signup_confirmation ?? true,
      send_volunteer_alert: payload.send_volunteer_alert ?? true,
      slug: payload.slug,
      // `fields` is a jsonb column but the generated Kysely model types it as `string[]`.
      // node-postgres serializes a raw JS array parameter as a Postgres ARRAY literal
      // (e.g. `{a,b,c}`), which Postgres then rejects as invalid JSON for a jsonb column.
      // Stringifying it first makes node-postgres send plain text, which Postgres casts
      // to jsonb correctly.
      fields: JSON.stringify(payload.fields ?? DEFAULT_FIELDS) as unknown as string[],
    } as OperationDataType<'volunteer_events', 'insert'>;
    return this.add(row);
  }

  public async checkSlugUnique(slug: string, excludeId: string | null, _auth: IAuthKeyPayload) {
    if (!slug) return { unique: true };
    let query = this.getRepo()
      .db.selectFrom('volunteer_events')
      .select('id')
      .where('tenant_id', '=', _auth.tenant_id)
      .where('slug', '=', slug);
    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }
    const existing = await query.executeTakeFirst();
    return { unique: !existing };
  }

  // Loose at the coercion boundary, same as addEvent above.
  public async updateEvent(id: string, payload: any, auth: IAuthKeyPayload) {
    if (payload.slug) {
      const existing = await this.getRepo()
        .db.selectFrom('volunteer_events')
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

    if (payload.start_time && payload.end_time && new Date(payload.end_time) <= new Date(payload.start_time)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'End date & time must be after the start date & time.' });
    }

    // `fields` is a jsonb column but modeled as `string[]`; pull it out of the raw payload
    // spread and stringify it so node-postgres sends valid JSON text instead of a Postgres
    // ARRAY literal (see addEvent() above for the full explanation).
    const { fields, ...restPayload } = payload;
    const row = {
      ...restPayload,
      ...(fields !== undefined ? { fields: JSON.stringify(fields) as unknown as string[] } : {}),
      updatedby_id: auth.user_id,
    } as OperationDataType<'volunteer_events', 'update'>;
    const result = await this.update({
      tenant_id: auth.tenant_id,
      id,
      row,
    });

    if (payload.send_reminder === false) {
      try {
        await this.getRepo()
          .db.deleteFrom('background_jobs')
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'pending')
          .where(sql`payload->>'type'`, '=', 'send-shift-reminder')
          .where(sql`payload->>'eventId'`, '=', String(id))
          .execute();
      } catch (err) {
        logger.error({ err }, 'Failed to clean up pending reminders for disabled event reminders');
      }
    } else if (payload.send_reminder === true) {
      try {
        // Fetch all signed up shifts for this event
        const shifts = await this.getRepo()
          .db.selectFrom('volunteer_shifts')
          .select(['id', 'person_id'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('event_id', '=', id)
          .where('status', '=', 'signed_up')
          .execute();

        // Fetch event start time
        const event = await this.getRepo()
          .db.selectFrom('volunteer_events')
          .select(['start_time'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', '=', id)
          .executeTakeFirst();

        if (event) {
          const startMs = new Date(event.start_time).getTime();
          const nowMs = Date.now();
          if (startMs > nowMs) {
            const runAt = new Date(Math.max(nowMs, startMs - 24 * 60 * 60 * 1000));
            for (const shift of shifts) {
              // Delete existing pending reminder for safety
              await this.getRepo()
                .db.deleteFrom('background_jobs')
                .where('tenant_id', '=', auth.tenant_id)
                .where('status', '=', 'pending')
                .where(sql`payload->>'type'`, '=', 'send-shift-reminder')
                .where(sql`payload->>'shiftId'`, '=', String(shift.id))
                .execute();

              // Queue new reminder
              await this.getRepo()
                .db.insertInto('background_jobs')
                .values({
                  tenant_id: auth.tenant_id,
                  queue: 'default',
                  status: 'pending',
                  payload: JSON.stringify({
                    type: 'send-shift-reminder',
                    shiftId: String(shift.id),
                    eventId: String(id),
                    personId: String(shift.person_id),
                    tenantId: auth.tenant_id,
                  }),
                  run_at: runAt,
                })
                .execute();
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to re-schedule shift reminders for event');
      }
    }

    return result;
  }

  public async getShiftsForEvent(event_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getShiftsForEvent({
      tenant_id: auth.tenant_id,
      event_id,
    });
  }

  public async signupVolunteer(payload: AddVolunteerShiftType, auth: IAuthKeyPayload) {
    const result = await this.getRepo().signupVolunteer({
      tenant_id: auth.tenant_id,
      event_id: payload.event_id,
      person_id: payload.person_id,
      status: payload.status,
      hours_worked: payload.hours_worked,
      notes: payload.notes,
      user_id: auth.user_id,
    });

    if (result && result.status === 'signed_up') {
      try {
        const event = await this.getRepo()
          .db.selectFrom('volunteer_events')
          .select(['start_time', 'send_reminder'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('id', '=', payload.event_id)
          .executeTakeFirst();

        if (event && event.send_reminder !== false) {
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
                  type: 'send-shift-reminder',
                  shiftId: String(result.id),
                  eventId: String(payload.event_id),
                  personId: String(payload.person_id),
                  tenantId: auth.tenant_id,
                }),
                run_at: runAt,
              })
              .execute();
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to schedule shift reminder for volunteer');
      }

      // Trigger volunteer signup workflows
      try {
        const workflowsController = new WorkflowsController();
        await this.getRepo()
          .transaction()
          .execute(async (trx) => {
            await workflowsController.triggerVolunteerSignup(
              auth.tenant_id,
              String(payload.person_id),
              String(payload.event_id),
              trx,
            );
          });
      } catch (err) {
        logger.error({ err }, 'Failed to trigger volunteer signup workflows');
      }
    }

    if (result && result.status) {
      try {
        const workflowsController = new WorkflowsController();
        await this.getRepo()
          .transaction()
          .execute(async (trx) => {
            await workflowsController.triggerWorkflow(
              auth.tenant_id,
              String(payload.person_id),
              'volunteer_shift_status',
              result.status,
              trx,
            );
          });
      } catch (err) {
        logger.error({ err }, 'Failed to trigger volunteer_shift_status workflow in signupVolunteer');
      }
    }

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'assign',
        entity: 'volunteer_shifts',
        entity_id: result?.id ? String(result.id) : null,
        quantity: 1,
        metadata: { id: result?.id, event_id: payload.event_id, person_id: payload.person_id },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log shift signup activity');
    }

    return result;
  }

  public async updateShift(id: string, payload: UpdateVolunteerShiftType, auth: IAuthKeyPayload) {
    const result = await this.getRepo().updateShift({
      tenant_id: auth.tenant_id,
      id,
      row: payload,
      user_id: auth.user_id,
    });

    if (result) {
      // Trigger volunteer shift status workflows
      if (payload.status) {
        try {
          const workflowsController = new WorkflowsController();
          await this.getRepo()
            .transaction()
            .execute(async (trx) => {
              await workflowsController.triggerWorkflow(
                auth.tenant_id,
                String(result.person_id),
                'volunteer_shift_status',
                payload.status,
                trx,
              );
            });
        } catch (err) {
          logger.error({ err }, 'Failed to trigger volunteer_shift_status workflows');
        }
      }

      try {
        if (payload.status && payload.status !== 'signed_up') {
          // Cancel/remove pending reminder
          await this.getRepo()
            .db.deleteFrom('background_jobs')
            .where('tenant_id', '=', auth.tenant_id)
            .where('status', '=', 'pending')
            .where(sql`payload->>'type'`, '=', 'send-shift-reminder')
            .where(sql`payload->>'shiftId'`, '=', String(id))
            .execute();
        } else if (payload.status === 'signed_up') {
          // Remove existing pending reminders first
          await this.getRepo()
            .db.deleteFrom('background_jobs')
            .where('tenant_id', '=', auth.tenant_id)
            .where('status', '=', 'pending')
            .where(sql`payload->>'type'`, '=', 'send-shift-reminder')
            .where(sql`payload->>'shiftId'`, '=', String(id))
            .execute();

          // Fetch event to check if we should schedule a new reminder
          const event = await this.getRepo()
            .db.selectFrom('volunteer_events')
            .select(['start_time', 'send_reminder'])
            .where('tenant_id', '=', auth.tenant_id)
            .where('id', '=', result.event_id)
            .executeTakeFirst();

          if (event && event.send_reminder !== false) {
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
                    type: 'send-shift-reminder',
                    shiftId: String(id),
                    eventId: String(result.event_id),
                    personId: String(result.person_id),
                    tenantId: auth.tenant_id,
                  }),
                  run_at: runAt,
                })
                .execute();
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to update shift reminder job status');
      }
    }

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'volunteer_shifts',
        entity_id: id,
        quantity: 1,
        metadata: { id, status: payload.status },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log shift update activity');
    }

    return result;
  }

  public async deleteShift(id: string, auth: IAuthKeyPayload) {
    const result = await this.getRepo().deleteShift({
      tenant_id: auth.tenant_id,
      id,
    });

    if (result) {
      try {
        await this.getRepo()
          .db.deleteFrom('background_jobs')
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'pending')
          .where(sql`payload->>'type'`, '=', 'send-shift-reminder')
          .where(sql`payload->>'shiftId'`, '=', String(id))
          .execute();
      } catch (err) {
        logger.error({ err }, 'Failed to delete pending shift reminder job');
      }
    }

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'delete',
        entity: 'volunteer_shifts',
        entity_id: id,
        quantity: 1,
        metadata: { id },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log shift delete activity');
    }

    return result;
  }

  public async getHistoryForPerson(person_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getHistoryForPerson({
      tenant_id: auth.tenant_id,
      person_id,
    });
  }

  public async getVolunteerStats(person_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getVolunteerStats({
      tenant_id: auth.tenant_id,
      person_id,
    });
  }

  public async getTenantPublic(tenantId: string) {
    return this.getRepo().db.selectFrom('tenants').select(['name']).where('id', '=', tenantId).executeTakeFirst();
  }

  public async getUpcomingEventsPublic(tenantId: string) {
    return this.getRepo()
      .db.selectFrom('volunteer_events')
      .select([
        'volunteer_events.id',
        'volunteer_events.tenant_id',
        'volunteer_events.name',
        'volunteer_events.description',
        'volunteer_events.location_address',
        'volunteer_events.start_time',
        'volunteer_events.end_time',
        'volunteer_events.capacity',
        'volunteer_events.contact_email',
        'volunteer_events.contact_phone',
        'volunteer_events.is_private',
        'volunteer_events.send_reminder',
        'volunteer_events.slug',
      ])
      .select((eb) => [
        eb
          .selectFrom('volunteer_shifts')
          .whereRef('volunteer_shifts.event_id', '=', 'volunteer_events.id')
          .select(({ fn }) => [fn.count<number>('volunteer_shifts.id').as('volunteers_count')])
          .as('volunteers_count'),
      ])
      .where('volunteer_events.tenant_id', '=', tenantId)
      .where('volunteer_events.end_time', '>=', new Date())
      .where('volunteer_events.is_private', '=', false)
      .orderBy('volunteer_events.start_time', 'asc')
      .execute();
  }

  /**
   * Public signup-page lookup. Tenant-scoped by slug: volunteer-event slugs are unique per tenant,
   * and the tenant is resolved from the subdomain (lib/public-tenant) before any event query runs.
   */
  public async getEventPublic(tenantId: string, slug: string) {
    return this.getRepo()
      .db.selectFrom('volunteer_events')
      .select([
        'volunteer_events.id',
        'volunteer_events.tenant_id',
        'volunteer_events.name',
        'volunteer_events.description',
        'volunteer_events.location_address',
        'volunteer_events.start_time',
        'volunteer_events.end_time',
        'volunteer_events.capacity',
        'volunteer_events.contact_email',
        'volunteer_events.contact_phone',
        'volunteer_events.is_private',
        'volunteer_events.send_reminder',
        'volunteer_events.slug',
        'volunteer_events.fields',
      ])
      .select((eb) => [
        eb
          .selectFrom('volunteer_shifts')
          .whereRef('volunteer_shifts.event_id', '=', 'volunteer_events.id')
          .select(({ fn }) => [fn.count<number>('volunteer_shifts.id').as('volunteers_count')])
          .as('volunteers_count'),
      ])
      .where('volunteer_events.tenant_id', '=', tenantId)
      .where('volunteer_events.slug', '=', slug)
      .executeTakeFirst();
  }

  /**
   * Everything the public /v/:slug SPA page renders in one payload: the event, live signup count,
   * and the org name. Unknown slugs throw NOT_FOUND.
   */
  public async getPublicEventConfig(tenantId: string, slug: string) {
    const event = await this.getEventPublic(tenantId, slug);
    if (!event) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found.' });
    }

    const orgName = await publicOrgName(tenantId);
    const volunteersCount = Number(event.volunteers_count || 0);
    const isPast = new Date(event.end_time) < new Date();
    const isFull = event.capacity !== null && volunteersCount >= event.capacity;
    const remaining = event.capacity !== null ? Math.max(0, event.capacity - volunteersCount) : null;

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
        is_private: !!event.is_private,
        fields,
      },
      volunteersCount,
      isPast,
      isFull,
      remaining,
    };
  }

  /** Upcoming public volunteer events for the tenant's /volunteer listing page. */
  public async getPublicEventListing(tenantId: string) {
    const [orgName, events] = await Promise.all([publicOrgName(tenantId), this.getUpcomingEventsPublic(tenantId)]);
    return {
      orgName,
      events: events.map((ev) => {
        const volunteersCount = Number(ev.volunteers_count || 0);
        const remaining = ev.capacity !== null ? Math.max(0, ev.capacity - volunteersCount) : null;
        return {
          slug: String(ev.slug),
          name: String(ev.name),
          description: ev.description ?? null,
          location_address: ev.location_address ?? null,
          start_time: ev.start_time,
          end_time: ev.end_time,
          capacity: ev.capacity ?? null,
          isFull: ev.capacity !== null && volunteersCount >= ev.capacity,
          remaining,
        };
      }),
    };
  }

  public async signupVolunteerPublic(
    tenantId: string,
    slug: string,
    payload: Record<string, string>,
    clientIp: string,
    opts?: { skipIpRateLimit?: boolean },
  ) {
    // 1. Rate limiting check. Keyed (workspace-API-key) submissions skip the per-IP window —
    // they come from one integration server and are rate-limited per tenant by the route.
    if (!opts?.skipIpRateLimit) {
      const now = Date.now();
      let timestamps = ipSignupTimestamps.get(clientIp) || [];
      timestamps = timestamps.filter((t) => now - t < SIGNUP_RATE_LIMIT_WINDOW_MS);
      if (timestamps.length >= SIGNUP_RATE_LIMIT_MAX) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded. Please try again in a minute.',
        });
      }
      timestamps.push(now);
      // Prune the key if empty to prevent unbounded Map growth across long-lived processes
      if (timestamps.length > 0) {
        ipSignupTimestamps.set(clientIp, timestamps);
      } else {
        ipSignupTimestamps.delete(clientIp);
      }
    }

    // 2. Fetch the event — tenant-scoped by slug
    const event = await this.getEventPublic(tenantId, slug);
    if (!event) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Event not found.',
      });
    }

    // 3. Honeypot check
    if (payload['_hp'] && payload['_hp'].trim().length > 0) {
      logger.warn(`Spam bot detected from IP ${clientIp} for volunteer event ${slug}`);
      return { success: true }; // Silent mock success
    }

    // 4. Validate email
    const email = payload['email']?.trim();
    if (!email) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email address is required.',
      });
    }

    // 5. Check capacity limit
    const currentCount = Number(event.volunteers_count || 0);
    if (event.capacity !== null && currentCount >= event.capacity) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This event is already at full capacity.',
      });
    }

    const firstName = payload['first_name'] || payload['firstName'] || null;
    const lastName = payload['last_name'] || payload['lastName'] || null;
    const mobile = payload['mobile'] || payload['phone'] || null;
    const notes = payload['notes'] || payload['message'] || null;

    // 6. Transaction to find/create person, tags, and shift
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

        if (!householdId) {
          throw new Error('Tenant placeholder household is not configured.');
        }
        if (!creatorId) {
          throw new Error('Tenant admin_id is not configured.');
        }

        const campaignId = await this.getCampaignId(tenantId, trx);

        // Check if email already exists
        const existing = await trx
          .selectFrom('persons')
          .select(['id', 'first_name', 'last_name', 'mobile', 'notes'])
          .where('tenant_id', '=', tenantId)
          .where(sql`lower(email)`, '=', email.toLowerCase())
          .executeTakeFirst();

        let personId: string;

        if (existing) {
          personId = String(existing.id);
          const updateRow: UpdateObject<Models, 'persons'> = {
            updatedby_id: creatorId,
            updated_at: sql`now()`,
          };
          if (!existing.first_name && firstName) updateRow.first_name = firstName;
          if (!existing.last_name && lastName) updateRow.last_name = lastName;
          if (!existing.mobile && mobile) updateRow.mobile = mobile;
          if (!existing.notes && notes) {
            updateRow.notes = notes;
          } else if (existing.notes && notes) {
            updateRow.notes = `${existing.notes}\n\nVolunteer Signup notes: ${notes}`;
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
          const insertRow = {
            tenant_id: tenantId,
            campaign_id: campaignId,
            household_id: householdId,
            createdby_id: creatorId,
            updatedby_id: creatorId,
            first_name: firstName,
            last_name: lastName,
            email: email,
            mobile: mobile,
            notes: notes,
          };
          const insertRes = await trx.insertInto('persons').values(insertRow).returning('id').executeTakeFirstOrThrow();
          personId = String(insertRes.id);

          // Trigger contact created workflow
          try {
            const workflowsController = new WorkflowsController();
            await workflowsController.triggerWorkflow(tenantId, personId, 'contact_created', null, trx);
          } catch (err) {
            logger.error({ err }, 'Failed to trigger contact_created workflow in signupVolunteerPublic');
          }
        }

        // Check if shift already exists
        const existingShift = await trx
          .selectFrom('volunteer_shifts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('event_id', '=', event.id)
          .where('person_id', '=', personId)
          .executeTakeFirst();

        if (existingShift) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You are already signed up for this event.',
          });
        }

        const workflowsController = new WorkflowsController();

        // Add tag "volunteer" and "event: <event name>"
        const allTagsToApply = ['volunteer', `event: ${event.name}`];
        for (const tagName of allTagsToApply) {
          const normalizedTagName = tagName.trim().toLowerCase();
          if (!normalizedTagName) continue;

          let tag = await trx
            .selectFrom('tags')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('name', '=', normalizedTagName)
            .where('type', '=', 'tag')
            .executeTakeFirst();

          if (!tag) {
            try {
              const insertTagRes = await trx
                .insertInto('tags')
                .values({
                  tenant_id: tenantId,
                  name: normalizedTagName,
                  type: 'tag',
                  deletable: true,
                  createdby_id: creatorId,
                  updatedby_id: creatorId,
                })
                .returning('id')
                .executeTakeFirst();
              if (insertTagRes) {
                tag = { id: insertTagRes.id };
              }
            } catch (insertErr) {
              // Concurrent insert fallback: fetch the tag that was just inserted
              tag = await trx
                .selectFrom('tags')
                .select('id')
                .where('tenant_id', '=', tenantId)
                .where('name', '=', normalizedTagName)
                .where('type', '=', 'tag')
                .executeTakeFirst();
              if (!tag) throw insertErr;
            }
          }

          if (tag) {
            const mapExists = await trx
              .selectFrom('map_peoples_tags')
              .select('person_id')
              .where('tenant_id', '=', tenantId)
              .where('person_id', '=', personId)
              .where('tag_id', '=', tag.id)
              .executeTakeFirst();

            if (!mapExists) {
              await trx
                .insertInto('map_peoples_tags')
                .values({
                  tenant_id: tenantId,
                  person_id: personId,
                  tag_id: tag.id,
                  createdby_id: creatorId,
                  updatedby_id: creatorId,
                })
                .onConflict((oc) => oc.columns(['tenant_id', 'person_id', 'tag_id']).doNothing())
                .execute();

              // Trigger tag_added and specialized subscriber workflows
              try {
                await workflowsController.triggerTagAdded(tenantId, personId, String(tag.id), normalizedTagName, trx);
              } catch (err) {
                logger.error({ err }, 'Failed to trigger tag_added workflow in signupVolunteerPublic');
              }
            }
          }
        }

        // Insert Shift
        const shiftResult = await trx
          .insertInto('volunteer_shifts')
          .values({
            tenant_id: tenantId,
            event_id: event.id,
            person_id: personId,
            status: 'signed_up',
            notes: notes,
            createdby_id: creatorId,
            updatedby_id: creatorId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const shiftId = shiftResult.id;

        // Log user activity
        await trx
          .insertInto('user_activity')
          .values({
            tenant_id: tenantId,
            user_id: creatorId,
            activity: 'signup',
            entity: 'volunteer_events',
            entity_id: String(event.id),
            quantity: 1,
            metadata: JSON.stringify({ person_id: personId, email }),
            createdby_id: creatorId,
            updatedby_id: creatorId,
          })
          .execute();

        // Queue email notification job in background
        await trx
          .insertInto('background_jobs')
          .values({
            tenant_id: tenantId,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'send-form-notifications',
              eventId: String(event.id),
              tenantId,
              email,
              firstName,
              lastName,
              mobile,
              notes,
            }),
            run_at: new Date(),
          })
          .execute();

        // Queue shift reminder email if enabled
        if (event.send_reminder !== false) {
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
                  type: 'send-shift-reminder',
                  shiftId: String(shiftId),
                  eventId: String(event.id),
                  personId: String(personId),
                  tenantId,
                }),
                run_at: runAt,
              })
              .execute();
          }
        }

        // Trigger volunteer signup workflows
        try {
          const workflowsController = new WorkflowsController();
          await workflowsController.triggerVolunteerSignup(tenantId, personId, String(event.id), trx);
        } catch (err) {
          logger.error({ err }, 'Failed to trigger volunteer signup workflows in public form');
        }
      });

    return { success: true };
  }

  private async getCampaignId(tenantId: string, trx: Transaction<Models>): Promise<string> {
    const row = await trx
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'current_campaign')
      .executeTakeFirst();

    if (row) {
      const value = row.value;
      if (typeof value === 'number' || typeof value === 'string') {
        return String(value);
      }
      if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
        const id = (value as Record<string, unknown>)['id'];
        if (typeof id === 'number' || typeof id === 'string') {
          return String(id);
        }
      }
    }

    const campaignRow = await trx
      .selectFrom('campaigns')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .limit(1)
      .executeTakeFirst();

    if (campaignRow) {
      return String(campaignRow.id);
    }

    throw new Error('No campaign found for this tenant.');
  }
}
