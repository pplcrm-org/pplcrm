import type {
  AddWebFormType,
  CreateFormType,
  FormField,
  IAuthKeyPayload,
  UpdateFormType,
  UpdateWebFormType,
} from '../../../../../../libs/common/src';
import { FORM_TEMPLATES, fieldsForTemplate, normForm, slugifyRecordName } from '../../../../../../libs/common/src';
import { BaseController } from '../../lib/base.controller';
import { uniqueSlug } from '../../lib/slug';
import { WebFormsRepo } from './repositories/web-forms.repo';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { type Transaction, sql } from 'kysely';
import { TRPCError } from '@trpc/server';
import { env } from '../../../env';
import { createSigner, createVerifier } from 'fast-jwt';
import { fingerprintFull, fingerprintStreet } from '../../lib/address-normalize';
import { publicOrgName, type PublicTenant } from '../../lib/public-tenant';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { HouseholdRepo } from '../households/repositories/households.repo';

import { WorkflowsController } from '../workflows/controller';
import { DonationsController } from '../donations/controller';
import { logger } from '../../logger';
import { isRateLimited } from '../../lib/rate-limiter';
import { assertPlanFeature } from '../billing/plan-gate';

// Sliding-window per-IP submission limit. Counters live in the shared limiter (lib/rate-limiter),
// which sweeps stale keys; see the single-instance caveat documented there.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class WebFormsController extends BaseController<'web_forms', WebFormsRepo> {
  private readonly campaignsRepo = new CampaignsRepo();

  constructor() {
    super(new WebFormsRepo());
  }

  public override async getOneById(input: { tenant_id: string; id: string }) {
    const form = await super.getOneById(input);
    if (!form) return form;
    return this.resolveCreatorAndUpdater(input.tenant_id, form);
  }

  /**
   * Tenant-scoped lookup for the server-rendered public donation page (/api/forms/d/:slug).
   * Only donation-type forms resolve here — standard forms live on the /f/:slug SPA page.
   */
  public async getDonationFormPublic(tenantId: string, slug: string) {
    const form = await this.getRepo().getBySlugPublic(tenantId, slug);
    if (!form || (form.form_type !== 'donation' && form.form_type !== 'recurring_donation')) {
      return undefined;
    }
    return form;
  }

  public async addForm(payload: AddWebFormType, auth: IAuthKeyPayload) {
    const row = {
      tenant_id: auth.tenant_id,
      campaign_id: await this.campaignsRepo.resolveForWrite({ tenant_id: auth.tenant_id }),
      slug: await this.uniqueSlug(auth.tenant_id, payload.name),
      name: payload.name,
      description: payload.description ?? null,
      redirect_url: payload.redirect_url ?? null,
      target_tags: payload.target_tags ? JSON.stringify(payload.target_tags) : null,
      target_lists: payload.target_lists ? JSON.stringify(payload.target_lists) : null,
      fields: payload.fields ? JSON.stringify(payload.fields) : null,
      status: this.mapLegacyStatus(payload.status),
      send_confirmation: payload.send_confirmation ?? true,
      send_alert: payload.send_alert ?? true,
      form_type: payload.form_type ?? 'standard',
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    };
    const created = await this.add(row as any);
    const createdId = (created as Record<string, unknown> | undefined)?.['id'];
    if (createdId != null && payload.target_lists?.length) {
      await this.syncTargetLists(auth, String(createdId), payload.target_lists);
    }
    return created;
  }

  public async updateForm(id: string, payload: UpdateWebFormType, auth: IAuthKeyPayload) {
    const existing = await this.getOneById({ tenant_id: auth.tenant_id, id });
    if (!existing) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Web form not found.',
      });
    }

    const row: OperationDataType<'web_forms', 'update'> = {
      updatedby_id: auth.user_id,
      updated_at: new Date(),
    };
    if (payload.name !== undefined) row.name = payload.name;
    if (payload.description !== undefined) row.description = payload.description;
    if (payload.redirect_url !== undefined) row.redirect_url = payload.redirect_url;
    if (payload.target_tags !== undefined)
      row.target_tags = payload.target_tags ? JSON.stringify(payload.target_tags) : null;
    if (payload.target_lists !== undefined)
      row.target_lists = payload.target_lists ? JSON.stringify(payload.target_lists) : null;
    if (payload.fields !== undefined) row.fields = payload.fields ? JSON.stringify(payload.fields) : null;
    if (payload.status !== undefined) row.status = this.mapLegacyStatus(payload.status);
    if (payload.send_confirmation !== undefined) row.send_confirmation = payload.send_confirmation;
    if (payload.send_alert !== undefined) row.send_alert = payload.send_alert;

    const rawPayload = payload as Record<string, unknown>;
    if (rawPayload['form_type'] !== undefined && rawPayload['form_type'] !== existing.form_type) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Form type cannot be changed after the form has been created.',
      });
    }

    const updated = await this.update({
      tenant_id: auth.tenant_id,
      id,
      row,
    });
    if (payload.target_lists !== undefined) {
      await this.syncTargetLists(auth, id, payload.target_lists ?? []);
    }
    return updated;
  }

  public async submitFormPublic(
    tenant: PublicTenant,
    slug: string,
    payload: Record<string, string>,
    clientIp: string,
    opts?: { skipIpRateLimit?: boolean },
  ): Promise<{ redirect_url?: string | null }> {
    // 1. Rate limiting check. Keyed (workspace-API-key) submissions skip the per-IP window —
    // they come from one integration server and are rate-limited per tenant by the route.
    if (!opts?.skipIpRateLimit) {
      // Backed by the shared limiter, which sweeps stale keys on a timer. The local Map this
      // used only ever pruned the requesting IP, so every distinct visitor accumulated forever.
      if (isRateLimited(`web-form-submit:${clientIp}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded. Please try again in a minute.',
        });
      }
    }

    // 2. Fetch the form — tenant-scoped by slug; the tenant was resolved from the subdomain
    const tenantId = tenant.id;
    const form = await this.getRepo().getBySlugPublic(tenantId, slug);
    if (!form || form.status !== 'published') {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Web form not found or inactive.',
      });
    }

    // 3. Plan gate. The web-forms tRPC router already gates authoring, but a downgrade left every
    // already-embedded form quietly accepting submissions — the gate only stopped you editing.
    // Enforced here rather than on the route so the keyless embed and the keyed server-side
    // submit are covered by one check. `assertPlanFeature` throws FORBIDDEN, which the public
    // route renders as its 403 page, so the visitor sees a real message rather than a blank fail.
    // A tenant is warned about exactly this before the downgrade goes through (BillingController).
    await assertPlanFeature(this.getRepo().db, tenantId, 'forms');
    const formId = String(form.id);

    // 4. Honeypot check
    if (payload['_hp'] && payload['_hp'].trim().length > 0) {
      logger.warn(`Spam bot detected from IP ${clientIp} for form ${formId}`);
      return { redirect_url: form.redirect_url || null };
    }

    // 5. Validate email
    const email = payload['email']?.trim();
    if (!email) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email address is required.',
      });
    }

    // Parse configured fields. Supports both the legacy string[] shape ("mobile:required") used by
    // donation/older forms and the new-model FormField[] objects ({ key, on, required, label }).
    const rawFields: unknown = form.fields
      ? Array.isArray(form.fields)
        ? form.fields
        : JSON.parse(String(form.fields))
      : ['first_name', 'last_name', 'email', 'mobile', 'notes'];
    const fieldArray: unknown[] = Array.isArray(rawFields) ? rawFields : [];

    // Map payload key aliases helper
    const getPayloadValue = (key: string): string => {
      let value = '';
      if (key === 'first_name') value = payload['first_name'] || payload['firstName'] || '';
      else if (key === 'last_name') value = payload['last_name'] || payload['lastName'] || '';
      else if (key === 'full_name' || key === 'name') value = payload['full_name'] || payload['name'] || '';
      else if (key === 'street1') value = payload['street1'] || payload['street_address'] || '';
      else if (key === 'zip') value = payload['zip'] || payload['postal_code'] || '';
      else if (key === 'country') value = payload['country'] || payload['residency_country'] || '';
      else if (key === 'state') value = payload['state'] || payload['province'] || payload['residency_province'] || '';
      else value = payload[key] || '';
      return String(value).trim();
    };

    // Validate user-configured required fields for standard forms
    if (form.form_type !== 'donation' && form.form_type !== 'recurring_donation') {
      const fieldLabels: Record<string, string> = {
        first_name: 'First Name',
        last_name: 'Last Name',
        full_name: 'Full name',
        mobile: 'Mobile / Phone',
        notes: 'Notes / Message',
        street1: 'Street Address',
        city: 'City',
        state: 'State / Province',
        zip: 'Zip / Postal Code',
        country: 'Country',
      };

      const requiredFields: { name: string; label: string }[] = [];
      for (const raw of fieldArray) {
        if (typeof raw === 'string') {
          if (raw.endsWith(':required')) {
            const name = raw.replace(':required', '');
            requiredFields.push({ name, label: fieldLabels[name] ?? name });
          }
        } else if (raw && typeof raw === 'object') {
          const obj = raw as { key?: string; on?: boolean; required?: boolean; label?: string };
          // Email is validated separately above; skip it here.
          if (obj.key && obj.key !== 'email' && obj.on && obj.required) {
            requiredFields.push({ name: obj.key, label: obj.label ?? fieldLabels[obj.key] ?? obj.key });
          }
        }
      }

      for (const field of requiredFields) {
        if (!getPayloadValue(field.name)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${field.label} is required.` });
        }
      }
    }

    // Parse and validate donation fields if form is a donation or recurring_donation form
    let amountCents = 0;
    let monthlyAmountCents = 0;
    let country = '';
    let state = '';
    if (form.form_type === 'donation' || form.form_type === 'recurring_donation') {
      const firstName = (payload['first_name'] || payload['firstName'] || '').trim();
      const lastName = (payload['last_name'] || payload['lastName'] || '').trim();
      if (!firstName || !lastName) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'First name and last name are required for donations.',
        });
      }

      const street1 = (payload['street1'] || payload['street_address'] || '').trim();
      const city = (payload['city'] || '').trim();
      const zip = (payload['zip'] || payload['postal_code'] || '').trim();
      country = (payload['country'] || payload['residency_country'] || '').trim();
      state = (payload['state'] || payload['province'] || payload['residency_province'] || '').trim();

      if (!street1 || !city || !zip || !country || !state) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Street address, city, state/province, zip/postal code, and country of residence are required for donations.',
        });
      }

      // Check if email already exists to run eligibility checks
      const existing = await this.getRepo()
        .db.selectFrom('persons')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where(sql`lower(email)`, '=', email.toLowerCase())
        .executeTakeFirst();

      const donationsController = new DonationsController();

      if (form.form_type === 'donation') {
        const amountStr = payload['amount'] || payload['donation_amount'] || '';
        const amountDollars = parseFloat(amountStr);
        if (isNaN(amountDollars) || amountDollars <= 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'A valid donation amount is required.' });
        }
        amountCents = Math.round(amountDollars * 100);

        const check = await donationsController.checkEligibility(
          tenantId,
          existing ? String(existing.id) : '0',
          amountCents,
          { country, state },
        );
        if (!check.eligible) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
      } else {
        // recurring_donation
        const amountStr = payload['monthly_amount'] || payload['amount'] || '';
        const amountDollars = parseFloat(amountStr);
        if (isNaN(amountDollars) || amountDollars <= 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'A valid monthly donation amount is required.' });
        }
        monthlyAmountCents = Math.round(amountDollars * 100);

        const check = await donationsController.checkEligibility(
          tenantId,
          existing ? String(existing.id) : '0',
          monthlyAmountCents,
          { country, state },
          { isRecurring: true },
        );
        if (!check.eligible) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
      }
    }

    // 6. Gather submission fields. New-model forms collect a single `full_name`; split it on the
    // last space so the person record still gets a first/last name.
    let firstName = payload['first_name'] || payload['firstName'] || null;
    let lastName = payload['last_name'] || payload['lastName'] || null;
    if (!firstName && !lastName) {
      const fullName = (payload['full_name'] || payload['name'] || '').trim();
      if (fullName) {
        const lastSpace = fullName.lastIndexOf(' ');
        if (lastSpace === -1) {
          firstName = fullName;
        } else {
          firstName = fullName.slice(0, lastSpace).trim();
          lastName = fullName.slice(lastSpace + 1).trim();
        }
      }
    }
    const mobile = payload['mobile'] || payload['phone'] || null;
    const notes = payload['notes'] || payload['message'] || null;

    let resolvedPersonId = '';
    let resolvedCreatorId = '1';

    // 7. Find or Create person & apply merges/tags
    await this.getRepo()
      .transaction()
      .execute(async (trx: Transaction<Models>) => {
        const tenantRow = await trx
          .selectFrom('tenants')
          .select(['placeholder_household_id'])
          .where('id', '=', tenantId)
          .executeTakeFirst();

        const householdId = tenantRow?.placeholder_household_id;
        // Use the form's creator as the actor — they are the person who
        // configured this form, which is the most correct attribution for
        // contacts and data created via public submissions.
        const creatorId = String(form.createdby_id);

        resolvedCreatorId = creatorId;

        if (!householdId) {
          throw new Error('Tenant placeholder household is not configured.');
        }

        // Submissions belong to the FORM's campaign (§15) — a campaign sign-up
        // form collects that campaign's consent, not the office's. Older rows
        // without a campaign fall back to the legacy current_campaign setting.
        const formCampaignId = (form as Record<string, unknown>)['campaign_id'];
        const campaignId = formCampaignId != null ? String(formCampaignId) : await this.getCampaignId(tenantId, trx);

        // When the tenant requires double opt-in, new subscribers are created as 'pending' and only
        // counted once they confirm via the emailed link (see confirm-subscription route).
        const doubleOptIn = await this.isDoubleOptInEnabled(tenantId, trx);

        let finalHouseholdId = householdId;

        const street1 = (payload['street1'] || payload['street_address'] || '').trim();
        const city = (payload['city'] || '').trim();
        const zip = (payload['zip'] || payload['postal_code'] || '').trim();
        const country = (payload['country'] || payload['residency_country'] || '').trim();
        const state = (payload['state'] || payload['province'] || payload['residency_province'] || '').trim();

        const hasAddress = !!(street1 || city || zip || country || state);

        if (hasAddress) {
          const fp_street = fingerprintStreet({ street1 });
          const fp_full = fingerprintFull({
            street1,
            city,
            state,
            zip,
            country,
          });

          const householdRepo = new HouseholdRepo();
          const existingHh = await trx
            .selectFrom('households')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('campaign_id', '=', campaignId)
            .where('address_fp_full', '=', fp_full)
            .executeTakeFirst();

          if (existingHh) {
            finalHouseholdId = String(existingHh.id);
          } else {
            const createdHhs = await householdRepo.addMany(
              {
                rows: [
                  {
                    tenant_id: tenantId,
                    campaign_id: campaignId,
                    createdby_id: creatorId,
                    updatedby_id: creatorId,
                    street1,
                    city,
                    state,
                    zip,
                    country,
                    address_fp_street: fp_street,
                    address_fp_full: fp_full,
                  } as any,
                ],
              },
              trx,
            );
            if (createdHhs && createdHhs[0] && createdHhs[0].id) {
              finalHouseholdId = String(createdHhs[0].id);
            }
          }
        }

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
          const updateRow: any = {
            updatedby_id: creatorId,
            updated_at: sql`now()`,
          };
          if (!existing.first_name && firstName) updateRow.first_name = firstName;
          if (!existing.last_name && lastName) updateRow.last_name = lastName;
          if (!existing.mobile && mobile) updateRow.mobile = mobile;
          if (form.form_type === 'donation' || hasAddress) {
            updateRow.household_id = finalHouseholdId;
          }
          if (!existing.notes && notes) {
            updateRow.notes = notes;
          } else if (existing.notes && notes) {
            updateRow.notes = `${existing.notes}\n\nSubmission notes: ${notes}`;
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
            household_id: finalHouseholdId,
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
            logger.error({ err }, 'Failed to trigger contact_created workflow in WebFormsController');
          }

          // Queue the double opt-in confirmation email (transactional outbox) for brand-new subscribers.
          if (doubleOptIn) {
            await this.enqueueSubscriptionConfirmation(trx, {
              tenantId,
              personId,
              email,
              firstName,
            });
          }
        }

        resolvedPersonId = personId;

        // Consent lives in campaign_subscriptions (§15): a form submission is
        // consent for THIS form's campaign only — pending until confirmed when
        // the tenant requires double opt-in. doNothing keeps an existing row
        // (including a deliberate 'unsubscribed') authoritative over re-submits.
        await trx
          .insertInto('campaign_subscriptions')
          .values({
            tenant_id: tenantId,
            campaign_id: campaignId,
            person_id: personId,
            email,
            status: doubleOptIn ? 'pending' : 'subscribed',
            consent_source: 'form',
            consent_at: doubleOptIn ? null : new Date(),
            createdby_id: creatorId,
            updatedby_id: creatorId,
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'campaign_id', 'person_id']).doNothing())
          .execute();

        const workflowsController = new WorkflowsController();

        // Add target custom tags & read-only system tag
        const targetTags: string[] = Array.isArray(form.target_tags)
          ? form.target_tags
          : JSON.parse((form.target_tags as any) || '[]');
        const systemTagName = `source: ${form.name}`;
        // "Donor" is derived from donations data (§15) — no tag on donation forms.
        const allTagsToApply = [...targetTags, systemTagName];

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
              .executeTakeFirstOrThrow();
            tag = { id: insertTagRes.id };
          }

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
              .execute();

            // Trigger tag_added and specialized subscriber workflows
            try {
              await workflowsController.triggerTagAdded(tenantId, personId, String(tag.id), normalizedTagName, trx);
            } catch (err) {
              logger.error({ err }, 'Failed to trigger tag_added workflow in WebFormsController');
            }
          }
        }

        // Add target lists. map_web_forms_lists is the source of truth — its
        // FKs guarantee every row points at a live list (no dangling-id skip
        // needed, unlike the legacy JSONB target_lists document).
        const targetListRows = await trx
          .selectFrom('map_web_forms_lists')
          .select('list_id')
          .where('tenant_id', '=', tenantId)
          .where('web_form_id', '=', formId)
          .execute();
        for (const { list_id: listId } of targetListRows) {
          const inList = await trx
            .selectFrom('map_lists_persons')
            .select('person_id')
            .where('tenant_id', '=', tenantId)
            .where('person_id', '=', personId)
            .where('list_id', '=', listId)
            .executeTakeFirst();

          if (!inList) {
            await trx
              .insertInto('map_lists_persons')
              .values({
                tenant_id: tenantId,
                person_id: personId,
                list_id: listId,
                createdby_id: creatorId,
                updatedby_id: creatorId,
              })
              .execute();

            // Trigger list joined workflows
            try {
              await workflowsController.triggerWorkflow(tenantId, personId, 'list_joined', listId, trx);
            } catch (err) {
              logger.error({ err }, 'Failed to trigger list_joined workflow in WebFormsController');
            }
          }
        }

        // Trigger web form submitted workflows
        try {
          await workflowsController.triggerWorkflow(tenantId, personId, 'web_form_submitted', formId, trx);
        } catch (err) {
          logger.error({ err }, 'Failed to trigger web_form_submitted workflow in WebFormsController');
        }

        // Log user activity
        await trx
          .insertInto('user_activity')
          .values({
            tenant_id: tenantId,
            user_id: creatorId,
            activity: 'submission',
            entity: 'web_forms',
            entity_id: formId,
            quantity: 1,
            metadata: JSON.stringify({ person_id: personId, email }),
            createdby_id: creatorId,
            updatedby_id: creatorId,
          })
          .execute();

        // Persist a durable response record (answers snapshot + person FK) for the Responses tab.
        // Donation forms are a separate flow (Stripe/webhook) and are not part of this model.
        if (form.form_type !== 'donation' && form.form_type !== 'recurring_donation') {
          const answers: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(payload)) {
            if (key === '_hp') continue;
            answers[key] = value;
          }
          await trx
            .insertInto('form_submissions')
            .values({
              tenant_id: tenantId,
              form_id: String(form.id),
              person_id: personId,
              answers: JSON.stringify(answers),
            })
            .execute();
        }

        // Queue email notification job in background
        await trx
          .insertInto('background_jobs')
          .values({
            tenant_id: tenantId,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'send-webform-notifications',
              formId: String(form.id),
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
      });

    // 8. If donation/recurring form, initialize checkout session after transactional writes commit
    if (form.form_type === 'donation' || form.form_type === 'recurring_donation') {
      const donationsController = new DonationsController();
      const successUrl = `${env.apiUrl.replace(/\/$/, '')}/api/forms/success?checkout_session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${env.apiUrl.replace(/\/$/, '')}/api/forms/d/${form.slug}?t=${encodeURIComponent(tenant.slug)}&checkout_cancel=true`;

      if (form.form_type === 'donation') {
        const checkoutInit = await donationsController.createCheckoutSession(
          { tenant_id: tenantId, user_id: resolvedCreatorId },
          resolvedPersonId,
          amountCents,
          { country, state },
          { successUrl, cancelUrl },
        );
        return { redirect_url: checkoutInit.url };
      } else {
        const checkoutSession = await donationsController.createRecurringCheckoutSession(
          { tenant_id: tenantId, user_id: resolvedCreatorId },
          resolvedPersonId,
          monthlyAmountCents,
          { country, state },
          { successUrl, cancelUrl },
        );
        return { redirect_url: checkoutSession.url };
      }
    }

    return { redirect_url: form.redirect_url || null };
  }

  /**
   * Confirms a pending double opt-in subscription from a signed link. Public (unauthenticated) — the
   * token carries the tenant and person identity. Idempotent: an already-confirmed person stays confirmed.
   */
  public async confirmSubscription(token: string): Promise<{ success: boolean }> {
    const key = process.env['SHARED_SECRET'] || env.sharedSecret;
    if (!key) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server misconfiguration: SHARED_SECRET is missing.',
      });
    }

    const verifier = createVerifier({ algorithms: ['HS256'], key, ignoreExpiration: false });

    let payload: unknown;
    try {
      payload = await verifier(token);
    } catch {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This confirmation link is invalid or has expired.' });
    }

    if (
      !isRecord(payload) ||
      payload['purpose'] !== 'confirm-subscription' ||
      !payload['tenant_id'] ||
      !payload['person_id']
    ) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid confirmation token.' });
    }

    // Double opt-in confirmed: every pending subscription for this person
    // becomes subscribed (§15). Deliberately allowed even if the campaign has
    // since been archived — the confirmation belongs to when the link was sent.
    await this.getRepo()
      .db.updateTable('campaign_subscriptions')
      .set({ status: 'subscribed', consent_at: sql`now()`, updated_at: sql`now()` })
      .where('tenant_id', '=', String(payload['tenant_id']))
      .where('person_id', '=', String(payload['person_id']))
      .where('status', '=', 'pending')
      .execute();

    return { success: true };
  }

  private async isDoubleOptInEnabled(tenantId: string, trx: Transaction<Models>): Promise<boolean> {
    const row = await trx
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'communications.double_opt_in')
      .executeTakeFirst();

    return row?.value === true || row?.value === 'true';
  }

  /**
   * Inserts a transactional-outbox job that emails a new subscriber a signed confirmation link. The job
   * runs only if the surrounding submission transaction commits, keeping the pending person and the
   * confirmation email consistent.
   */
  private async enqueueSubscriptionConfirmation(
    trx: Transaction<Models>,
    args: { tenantId: string; personId: string; email: string; firstName: string | null },
  ): Promise<void> {
    const key = process.env['SHARED_SECRET'] || env.sharedSecret;
    if (!key) {
      logger.error('Cannot send subscription confirmation: SHARED_SECRET is missing.');
      return;
    }

    const signer = createSigner({ algorithm: 'HS256', key, expiresIn: '7d' });
    const token = signer({
      tenant_id: args.tenantId,
      person_id: args.personId,
      email: args.email.toLowerCase().trim(),
      purpose: 'confirm-subscription',
    });
    const confirmUrl = `${env.appUrl}/confirm-subscription?token=${token}`;

    await trx
      .insertInto('background_jobs')
      .values({
        tenant_id: args.tenantId,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'send-subscription-confirmation',
          tenantId: args.tenantId,
          email: args.email,
          firstName: args.firstName,
          confirmUrl,
        }),
        run_at: new Date(),
      })
      .execute();
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

  public async getSubmissionsCount(formId: string, tenantId: string): Promise<number> {
    return this.getRepo().countSubmissions(tenantId, formId);
  }

  // ---------------------------------------------------------------------------
  // North Star "living funnel" lifecycle (new Forms experience).
  // ---------------------------------------------------------------------------

  /** All non-donation forms as cards for the browse page, fields normalized for the preview. */
  public async listForms(tenantId: string) {
    const rows = await this.getRepo().listForms(tenantId);
    return rows.map((row) => this.normalizeForm(row));
  }

  /**
   * Public config for the unauthenticated /f/:slug page. Returns only what the public page renders,
   * plus the org name; closed (unpublished/archived) forms return a status the page shows as a
   * "closed" card. Throws NOT_FOUND when the slug doesn't exist at all.
   */
  public async getPublicFormBySlug(slug: string, tenantId: string) {
    const form = await this.getRepo().getBySlugPublic(tenantId, slug);
    // Donation forms have slugs too (every form does) but render on the separate server-rendered
    // /api/forms/d/:slug page with the amount field — never on the /f/:slug SPA page.
    if (!form || form.form_type === 'donation' || form.form_type === 'recurring_donation') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found.' });
    }
    const orgName = await publicOrgName(String(form.tenant_id));
    if (form.status !== 'published') {
      return { status: 'closed' as const, orgName, name: String(form.name) };
    }
    const normalized = this.normalizeForm(form) as {
      id: string;
      name: string;
      description: string | null;
      submit_label: string | null;
      thanks_title: string | null;
      thanks_body: string | null;
      redirect_url: string | null;
      fields: FormField[];
    };
    return {
      status: 'open' as const,
      orgName,
      form: {
        id: normalized.id,
        name: normalized.name,
        description: normalized.description,
        submit_label: normalized.submit_label,
        thanks_title: normalized.thanks_title,
        thanks_body: normalized.thanks_body,
        redirect_url: normalized.redirect_url,
        fields: normalized.fields.filter((f) => f.on),
      },
    };
  }

  /** Single form, fields normalized — used by the editor + preview. */
  public async getFormForEdit(id: string, tenantId: string) {
    const form = await this.getRepo().getOneById({ id, tenant_id: tenantId });
    if (!form) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found.' });
    }
    return this.normalizeForm(form);
  }

  /** Create a draft from a template. Lands the user in edit mode (frontend). */
  public async createForm(payload: CreateFormType, auth: IAuthKeyPayload) {
    const template = FORM_TEMPLATES[payload.type];
    const slug = await this.uniqueSlug(auth.tenant_id, payload.name);
    const fields = fieldsForTemplate(payload.type);
    const row = {
      tenant_id: auth.tenant_id,
      // A form collects consent for exactly one campaign (§15).
      campaign_id: await this.campaignsRepo.resolveForWrite({
        tenant_id: auth.tenant_id,
        campaign_id: payload.campaign_id,
      }),
      name: payload.name,
      description: template.description,
      redirect_url: null,
      target_tags: JSON.stringify([]),
      target_lists: JSON.stringify([]),
      fields: JSON.stringify(fields),
      status: 'draft',
      type: payload.type,
      form_type: 'standard',
      slug,
      submit_label: template.submitLabel,
      thanks_title: 'Thank you!',
      thanks_body: 'Your response has been recorded. Thanks for reaching out.',
      confirm_subject: `Thanks for your ${payload.type}`,
      confirm_body: 'Hi [First name],\n\nThanks for your submission. We’ve received it and will be in touch soon.',
      send_confirmation: true,
      send_alert: false,
      notify_team_on: false,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    };
    const created = await this.add(row as any);
    return this.normalizeForm(created);
  }

  /** Live-edit patch. `normForm` guarantees the email identity-key invariant server-side. */
  public async updateFormLive(id: string, patch: UpdateFormType, auth: IAuthKeyPayload) {
    const existing = await this.getRepo().getOneById({ id, tenant_id: auth.tenant_id });
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found.' });
    }

    const row: OperationDataType<'web_forms', 'update'> = { updatedby_id: auth.user_id, updated_at: new Date() };
    // Slug intentionally stays stable across renames — a published link must never break.
    if (patch.name !== undefined) row['name'] = patch.name;
    if (patch.description !== undefined) row['description'] = patch.description;
    if (patch.redirect_url !== undefined) row['redirect_url'] = patch.redirect_url;
    if (patch.submit_label !== undefined) row['submit_label'] = patch.submit_label;
    if (patch.thanks_title !== undefined) row['thanks_title'] = patch.thanks_title;
    if (patch.thanks_body !== undefined) row['thanks_body'] = patch.thanks_body;
    if (patch.confirm_email_on !== undefined) row['send_confirmation'] = patch.confirm_email_on;
    if (patch.confirm_subject !== undefined) row['confirm_subject'] = patch.confirm_subject;
    if (patch.confirm_body !== undefined) row['confirm_body'] = patch.confirm_body;
    if (patch.notify_team_on !== undefined) row['notify_team_on'] = patch.notify_team_on;
    if (patch.target_tags !== undefined) row['target_tags'] = JSON.stringify(patch.target_tags);
    if (patch.target_lists !== undefined) row['target_lists'] = JSON.stringify(patch.target_lists);
    if (patch.fields !== undefined) {
      row['fields'] = JSON.stringify(normForm(patch.fields));
    }

    const updated = await this.update({ tenant_id: auth.tenant_id, id, row });
    if (patch.target_lists !== undefined) {
      await this.syncTargetLists(auth, id, patch.target_lists ?? []);
    }
    return this.normalizeForm(updated);
  }

  /**
   * Replace the form's map_web_forms_lists rows (the source of truth for list
   * targeting — the JSONB target_lists column is still dual-written during
   * the transition, but nothing reads it for behavior anymore). Ids that
   * don't resolve to a live list in the tenant are dropped.
   */
  private async syncTargetLists(auth: IAuthKeyPayload, formId: string, listIds: string[]): Promise<void> {
    const db = this.getRepo().db;
    const candidates = [...new Set(listIds.map((id) => String(id)))].filter((id) => /^\d+$/.test(id));
    let liveIds: string[] = [];
    if (candidates.length > 0) {
      const rows = await db
        .selectFrom('lists')
        .select('id')
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', 'in', candidates)
        .execute();
      liveIds = rows.map((r) => String(r.id));
    }

    await db
      .deleteFrom('map_web_forms_lists')
      .where('tenant_id', '=', auth.tenant_id)
      .where('web_form_id', '=', formId)
      .execute();

    if (liveIds.length > 0) {
      await db
        .insertInto('map_web_forms_lists')
        .values(
          liveIds.map((list_id) => ({
            tenant_id: auth.tenant_id,
            web_form_id: formId,
            list_id,
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          })),
        )
        .execute();
    }
  }

  public publishForm(id: string, auth: IAuthKeyPayload) {
    return this.setStatus(id, auth, 'published', null);
  }

  public unpublishForm(id: string, auth: IAuthKeyPayload) {
    return this.setStatus(id, auth, 'draft', null);
  }

  public archiveForm(id: string, auth: IAuthKeyPayload) {
    return this.setStatus(id, auth, 'archived', new Date());
  }

  /** Restore always lands in draft — reopening a public link is a deliberate act. */
  public restoreForm(id: string, auth: IAuthKeyPayload) {
    return this.setStatus(id, auth, 'draft', null);
  }

  /** Hard delete is only allowed for a zero-response draft; everything else must be archived. */
  public async deleteForm(id: string, auth: IAuthKeyPayload) {
    const existing = (await this.getRepo().getOneById({ id, tenant_id: auth.tenant_id })) as
      | { status?: string }
      | undefined;
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found.' });
    }
    const count = await this.getRepo().countSubmissions(auth.tenant_id, id);
    if (existing.status !== 'draft' || count > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only a draft with no responses can be deleted. Archive it instead; archiving is reversible.',
      });
    }
    return this.delete(auth.tenant_id, id, auth.user_id);
  }

  public async getFormSubmissions(id: string, tenantId: string, cursor?: number) {
    const limit = 25;
    const offset = cursor ?? 0;
    const rows = await this.getRepo().getFormSubmissions(tenantId, id, limit + 1, offset);
    const total = await this.getRepo().countSubmissions(tenantId, id);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => {
      const answersRaw = row['answers'];
      const answers =
        typeof answersRaw === 'string'
          ? this.safeJson(answersRaw, {})
          : ((answersRaw as Record<string, unknown>) ?? {});
      const name = `${row['first_name'] ?? ''} ${row['last_name'] ?? ''}`.trim();
      return {
        id: String(row['id']),
        person_id: String(row['person_id']),
        person_name: name || null,
        answers,
        created_at: row['created_at'] as Date | string,
      };
    });
    return { items, total, nextCursor: hasMore ? offset + limit : null };
  }

  private async setStatus(
    id: string,
    auth: IAuthKeyPayload,
    status: 'draft' | 'published' | 'archived',
    archivedAt: Date | null,
  ) {
    const existing = await this.getRepo().getOneById({ id, tenant_id: auth.tenant_id });
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found.' });
    }
    const updated = await this.update({
      tenant_id: auth.tenant_id,
      id,
      row: { status, archived_at: archivedAt, updatedby_id: auth.user_id, updated_at: new Date() },
    });
    return this.normalizeForm(updated);
  }

  private uniqueSlug(tenantId: string, name: string, excludeId?: string): Promise<string> {
    // Shared slug strategy (lib/slug.ts) — same base + collision suffixes as
    // persons/households/companies record slugs.
    return uniqueSlug(slugifyRecordName(name, 'form'), (candidate) =>
      this.getRepo().slugExists(tenantId, candidate, excludeId),
    );
  }

  /** Legacy add/update path accepts 'active'; the DB only knows the lifecycle statuses. */
  private mapLegacyStatus(status: string | undefined): 'draft' | 'published' | 'archived' {
    if (status === 'archived') return 'archived';
    if (status === 'draft') return 'draft';
    return 'published';
  }

  private safeJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private normalizeForm(record: unknown) {
    if (!record || typeof record !== 'object') return record;
    const row = record as Record<string, unknown>;
    const toArray = (value: unknown): string[] => {
      if (Array.isArray(value)) return value as string[];
      if (typeof value === 'string') return this.safeJson<string[]>(value, []);
      return [];
    };
    const rawFields = Array.isArray(row['fields'])
      ? row['fields']
      : typeof row['fields'] === 'string'
        ? this.safeJson<unknown[]>(row['fields'] as string, [])
        : [];
    return {
      ...row,
      id: row['id'] != null ? String(row['id']) : row['id'],
      tenant_id: row['tenant_id'] != null ? String(row['tenant_id']) : row['tenant_id'],
      target_tags: toArray(row['target_tags']),
      target_lists: toArray(row['target_lists']),
      fields: normForm(rawFields),
      submission_count: row['submission_count'] != null ? Number(row['submission_count']) : 0,
    };
  }
}
