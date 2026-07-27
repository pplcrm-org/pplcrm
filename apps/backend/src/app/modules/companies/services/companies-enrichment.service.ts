import type { Kysely, Updateable } from 'kysely';
import { sql } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { logger } from '../../../logger';

/**
 * Per-run ceiling on enrichment jobs queued by the daily cron, across all tenants. Each job is a
 * Google Places call, so this also paces API spend; the leftovers are queued by the next run.
 */
const ENRICHMENT_QUEUE_BATCH = 2000;
/** Rows per insert statement, so one run never builds a single enormous multi-row INSERT. */
const ENRICHMENT_INSERT_CHUNK = 500;

/** Fields we lift from Google Places. All optional — Google may not know them. */
export interface CompanyLookupResult {
  website: string | null;
  phone: string | null;
  description: string | null;
  industry: string | null;
}

export class CompaniesEnrichmentService {
  constructor(private readonly db: Kysely<Models>) {}

  /**
   * Pure Google Places lookup by company name — no DB reads or writes. Used both
   * by the persisted background enrichment ({@link enrichCompany}) and by the
   * interactive add-time preview, where no company row exists yet. Returns a
   * mocked result under test/dev (no API key) so specs never hit the network.
   */
  public static async lookupByName(name: string): Promise<CompanyLookupResult> {
    const apiKey = env.googleMapsApiKey;
    const isMockOrTest = !apiKey || apiKey.includes('mock') || process.env['NODE_ENV'] === 'test';

    if (isMockOrTest) {
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return {
        website: `https://www.${cleanName || 'company'}.com`,
        phone: '+1 555-0199',
        description: `Mock description for ${name} from Google Places.`,
        industry: 'Technology',
      };
    }

    // Step 1: Text Search to find the Place ID.
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(name)}&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      throw new Error(`Google Places Text Search returned status ${searchRes.status}`);
    }
    const searchData: any = await searchRes.json();

    if (searchData.status !== 'OK' || !searchData.results || searchData.results.length === 0) {
      return { website: null, phone: null, description: null, industry: null };
    }

    // Step 2: Fetch Place Details for the top result.
    const placeId = searchData.results[0].place_id;
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,website,international_phone_number,formatted_phone_number,editorial_summary,types&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) {
      throw new Error(`Google Places Details returned status ${detailsRes.status}`);
    }
    const detailsData: any = await detailsRes.json();

    if (detailsData.status !== 'OK' || !detailsData.result) {
      return { website: null, phone: null, description: null, industry: null };
    }

    const res = detailsData.result;
    let industry: string | null = null;
    if (res.types && res.types.length > 0) {
      industry = String(res.types[0])
        .replace(/_/g, ' ')
        .split(' ')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    return {
      website: res.website || null,
      phone: res.formatted_phone_number || res.international_phone_number || null,
      description: res.editorial_summary?.overview || null,
      industry,
    };
  }

  public async enrichCompany(companyId: string, tenantId: string, force = false): Promise<void> {
    const company = await this.db
      .selectFrom('companies')
      .selectAll()
      .where('id', '=', companyId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!company) {
      logger.warn(`Company enrichment skipped: Company ${companyId} not found.`);
      return;
    }

    // Check if already enriched. A user-triggered "Re-check Google" (force)
    // re-runs the lookup; the first-load auto-queue does not.
    let currentEnrichment: Record<string, unknown> = {};
    if (company.enrichment) {
      currentEnrichment = typeof company.enrichment === 'string' ? JSON.parse(company.enrichment) : company.enrichment;
    }
    if (!force && currentEnrichment?.['google_enriched']) {
      logger.info(`Company ${companyId} is already enriched from Google. Skipping.`);
      return;
    }

    let lookup: CompanyLookupResult;
    try {
      lookup = await CompaniesEnrichmentService.lookupByName(company.name);
    } catch (err) {
      logger.error({ err }, `Google Places API enrichment failed for company ${companyId}`);
      throw err;
    }
    const { website, phone, description, industry } = lookup;

    const updatedEnrichment = {
      ...currentEnrichment,
      google_enriched: true,
      place_details: lookup,
    };

    const updatePayload: Updateable<Models['companies']> = {
      enrichment: JSON.stringify(updatedEnrichment),
      updated_at: new Date(),
    };

    if (!company.website || company.website.trim() === '') {
      updatePayload.website = website;
    }
    if (!company.phone || company.phone.trim() === '') {
      updatePayload.phone = phone;
    }
    if (!company.description || company.description.trim() === '') {
      updatePayload.description = description;
    }
    if (!company.industry || company.industry.trim() === '') {
      updatePayload.industry = industry;
    }

    await this.db
      .updateTable('companies')
      .set(updatePayload)
      .where('id', '=', companyId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  /**
   * Enqueue enrichment jobs for companies that have never been enriched.
   *
   * Called from the daily `refresh_companies_google` cron with no tenant, i.e. across every tenant
   * at once. It used to select every matching row with no limit and write them in one giant insert,
   * and it did not skip companies that already had a pending job — so a backlog re-duplicated the
   * whole queue every single day. Now: a per-run ceiling, batched inserts, and a NOT EXISTS guard.
   * Whatever is left over is simply picked up by tomorrow's run.
   */
  public async queueUnenrichedCompanies(tenantId?: string): Promise<number> {
    let query = this.db
      .selectFrom('companies')
      .select(['id', 'tenant_id'])
      .where((eb) => eb.or([eb('enrichment', 'is', null), sql<boolean>`enrichment->>'google_enriched' is null`]))
      // Don't re-queue a company that is already waiting to be enriched.
      .where(
        (eb) => sql<boolean>`not exists (
          select 1 from background_jobs bj
          where bj.status in ('pending', 'processing')
            and bj.payload->>'type' = 'enrich_company_google'
            and bj.payload->>'company_id' = ${eb.ref('companies.id')}::text
        )`,
      )
      .orderBy('id', 'asc')
      .limit(ENRICHMENT_QUEUE_BATCH);

    if (tenantId) {
      query = query.where('tenant_id', '=', tenantId);
    }

    const unenriched = await query.execute();
    if (unenriched.length === 0) return 0;

    const values = unenriched.map((c) => ({
      tenant_id: c.tenant_id,
      queue: 'default',
      status: 'pending',
      payload: JSON.stringify({
        type: 'enrich_company_google',
        company_id: String(c.id),
        tenant_id: String(c.tenant_id),
      }),
      run_at: new Date(),
      max_attempts: 3,
    }));

    for (let i = 0; i < values.length; i += ENRICHMENT_INSERT_CHUNK) {
      await this.db
        .insertInto('background_jobs')
        .values(values.slice(i, i + ENRICHMENT_INSERT_CHUNK))
        .execute();
    }

    if (unenriched.length === ENRICHMENT_QUEUE_BATCH) {
      logger.info(
        { queued: unenriched.length, tenantId: tenantId ?? 'all' },
        'Company enrichment hit the per-run cap; the remainder is picked up by the next run',
      );
    }

    return unenriched.length;
  }
}
