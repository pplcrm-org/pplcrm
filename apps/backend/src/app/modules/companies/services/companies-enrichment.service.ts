import type { Kysely, Transaction, Updateable } from 'kysely';
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
/** Deadline for each Google Places HTTP call — a hung connection must not stall a worker slot. */
const PLACES_TIMEOUT_MS = 10_000;

/** Job statuses that mean "this lookup is already queued or running — don't queue another". */
const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const;

const TEXT_SEARCH_ENDPOINT = 'Google Places Text Search';
const PLACE_DETAILS_ENDPOINT = 'Google Places Details';

/**
 * The legacy Places endpoints answer HTTP 200 and put the real outcome in a `status` field, so
 * the HTTP code alone tells you almost nothing. These three sets are the whole classification.
 */
/** Google answered and has no record of this place. A real answer — don't ask again. */
const NO_MATCH_STATUSES = new Set(['ZERO_RESULTS', 'NOT_FOUND']);
/** The request itself is rejected — wrong/blocked API key, Places API not enabled, malformed URL.
 *  Sending it again unchanged produces the same rejection. */
const DENIED_STATUSES = new Set(['REQUEST_DENIED', 'INVALID_REQUEST']);
/** Today's quota is gone or Google faulted. The same request may well succeed later. */
const RETRYABLE_STATUSES = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

/** Fields we lift from Google Places. All optional — Google may not know them. */
export interface CompanyLookupResult {
  website: string | null;
  phone: string | null;
  description: string | null;
  industry: string | null;
}

const EMPTY_LOOKUP: CompanyLookupResult = { website: null, phone: null, description: null, industry: null };

/**
 * How one Google Places lookup ended.
 *
 * The point of the union is to separate "Google answered" from "we never got an answer", which
 * the old boolean-ish return could not express: a rejected key and an exhausted quota both came
 * back as empty fields and were then stored as a successful enrichment.
 */
export type CompanyLookupOutcome =
  /** Google returned a place. */
  | { status: 'ok'; result: CompanyLookupResult }
  /** Google looked and found nothing. Final: re-asking gets the same answer. */
  | { status: 'no_match' }
  /** No API key is configured, so no call was made at all. Nothing to record. */
  | { status: 'not_configured' }
  /** Google refused the request (bad key, API disabled). Final until someone fixes the key. */
  | { status: 'denied'; detail: string }
  /** Quota exhausted, 5xx, or a network timeout. Worth retrying later. */
  | { status: 'unavailable'; detail: string };

/** Narrow unknown JSON to a property bag. Safe: every read off it is still `unknown`. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Turn a legacy Places `status` field into an outcome. Returns null for `OK`, meaning the caller
 * should carry on reading the body.
 *
 * Exported for unit tests — this is the whole of the "did it actually work" decision, and it is
 * pure, so it can be tested without touching the network.
 */
export function classifyPlacesStatus(
  endpoint: string,
  apiStatus: unknown,
  errorMessage: unknown,
): CompanyLookupOutcome | null {
  const status = typeof apiStatus === 'string' ? apiStatus : '';
  if (status === 'OK') return null;

  const message = asNonEmptyString(errorMessage);
  const detail = `${endpoint} returned status ${status || '(none)'}${message ? `: ${message}` : ''}`;

  if (NO_MATCH_STATUSES.has(status)) return { status: 'no_match' };
  if (DENIED_STATUSES.has(status)) return { status: 'denied', detail };
  if (RETRYABLE_STATUSES.has(status)) return { status: 'unavailable', detail };
  // An unrecognised status (including a future one Google adds) is treated as retryable on
  // purpose: guessing "permanent" would silently stop enriching a company forever.
  return { status: 'unavailable', detail };
}

/**
 * Classify a non-2xx HTTP response. Rate limiting and server faults pass; everything else in the
 * 4xx range is a request we cannot fix by sending it again.
 *
 * Exported for unit tests.
 */
export function classifyPlacesHttpFailure(endpoint: string, httpStatus: number): CompanyLookupOutcome {
  const detail = `${endpoint} returned HTTP ${httpStatus}`;
  if (httpStatus === HTTP_TOO_MANY_REQUESTS || httpStatus >= HTTP_SERVER_ERROR_MIN) {
    return { status: 'unavailable', detail };
  }
  return { status: 'denied', detail };
}

/**
 * True when Google's answer for this company is already on the row, or when we know the request
 * will be refused. In both cases queueing another lookup buys nothing and costs two billable
 * Google calls.
 *
 * Mirrors the SQL predicate in {@link CompaniesEnrichmentService.queueUnenrichedCompanies} —
 * change the two together.
 */
export function enrichmentIsSettled(enrichment: unknown): boolean {
  const record = asRecord(enrichment);
  if (record['google_enriched']) return true;
  return asRecord(record['google_lookup'])['status'] === 'denied';
}

/** Parse the `companies.enrichment` jsonb column, which arrives as either text or a parsed object. */
export function parseEnrichment(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return asRecord(raw);
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    // A row with unparseable JSON is treated as un-enriched rather than crashing the page load.
    return {};
  }
}

export class CompaniesEnrichmentService {
  constructor(private readonly db: Kysely<Models>) {}

  /**
   * Fabricated results are for tests and for a developer who deliberately sets a key containing
   * "mock". A missing key is NOT mock mode: inventing a website URL and storing it as though
   * Google had returned it is worse than storing nothing.
   */
  private static isMockMode(): boolean {
    const apiKey = env.googleMapsApiKey;
    return process.env['NODE_ENV'] === 'test' || (!!apiKey && apiKey.includes('mock'));
  }

  /** False when no lookup can happen at all, so callers can skip queueing work that would no-op. */
  public static isConfigured(): boolean {
    return CompaniesEnrichmentService.isMockMode() || !!env.googleMapsApiKey;
  }

  /**
   * True when this company already has an enrichment job waiting or running.
   *
   * Both queueing paths use this. The daily sweep has always had it (a backlog used to
   * re-duplicate the entire queue every day); the company-detail page load did not, so every
   * view before the first job completed queued another job for the same company.
   */
  public static async hasPendingEnrichmentJob(
    db: Kysely<Models> | Transaction<Models>,
    tenantId: string,
    companyId: string,
  ): Promise<boolean> {
    const existing = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', [...ACTIVE_JOB_STATUSES])
      .where(sql<boolean>`payload->>'type' = 'enrich_company_google'`)
      .where(sql<boolean>`payload->>'company_id' = ${companyId}`)
      .limit(1)
      .executeTakeFirst();
    return existing != null;
  }

  /**
   * Look a company up on Google Places and report exactly how it went.
   *
   * Never throws: a timeout or a DNS failure comes back as `unavailable` so the caller decides
   * whether that is worth retrying, instead of every failure looking alike.
   */
  public static async lookupOutcome(name: string): Promise<CompanyLookupOutcome> {
    if (CompaniesEnrichmentService.isMockMode()) {
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return {
        status: 'ok',
        result: {
          website: `https://www.${cleanName || 'company'}.com`,
          phone: '+1 555-0199',
          description: `Mock description for ${name} from Google Places.`,
          industry: 'Technology',
        },
      };
    }

    const apiKey = env.googleMapsApiKey;
    if (!apiKey) return { status: 'not_configured' };

    try {
      // Step 1: Text Search to find the Place ID.
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(name)}&key=${apiKey}`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(PLACES_TIMEOUT_MS) });
      if (!searchRes.ok) return classifyPlacesHttpFailure(TEXT_SEARCH_ENDPOINT, searchRes.status);

      const searchBody = asRecord(await searchRes.json());
      const searchOutcome = classifyPlacesStatus(
        TEXT_SEARCH_ENDPOINT,
        searchBody['status'],
        searchBody['error_message'],
      );
      if (searchOutcome) return searchOutcome;

      const results = Array.isArray(searchBody['results']) ? searchBody['results'] : [];
      const placeId = asNonEmptyString(asRecord(results[0])['place_id']);
      if (!placeId) return { status: 'no_match' };

      // Step 2: Fetch Place Details for the top result.
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,website,international_phone_number,formatted_phone_number,editorial_summary,types&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(PLACES_TIMEOUT_MS) });
      if (!detailsRes.ok) return classifyPlacesHttpFailure(PLACE_DETAILS_ENDPOINT, detailsRes.status);

      const detailsBody = asRecord(await detailsRes.json());
      const detailsOutcome = classifyPlacesStatus(
        PLACE_DETAILS_ENDPOINT,
        detailsBody['status'],
        detailsBody['error_message'],
      );
      if (detailsOutcome) return detailsOutcome;

      const place = asRecord(detailsBody['result']);
      if (Object.keys(place).length === 0) return { status: 'no_match' };

      const types = Array.isArray(place['types']) ? place['types'] : [];
      const firstType = asNonEmptyString(types[0]);
      const industry = firstType
        ? firstType
            .replace(/_/g, ' ')
            .split(' ')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
        : null;

      return {
        status: 'ok',
        result: {
          website: asNonEmptyString(place['website']),
          phone:
            asNonEmptyString(place['formatted_phone_number']) ?? asNonEmptyString(place['international_phone_number']),
          description: asNonEmptyString(asRecord(place['editorial_summary'])['overview']),
          industry,
        },
      };
    } catch (err) {
      // AbortSignal.timeout, DNS failures, socket resets. All worth another attempt later.
      return { status: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Pure Google Places lookup by company name — no DB reads or writes. Used by the interactive
   * add-time preview, where no company row exists yet and there is nothing to record: every
   * unsuccessful outcome flattens to all-null fields, so the form simply fills in nothing.
   *
   * Persisted enrichment must use {@link lookupOutcome} instead, because it has to tell a real
   * "Google has no record of this" apart from "we never reached Google".
   */
  public static async lookupByName(name: string): Promise<CompanyLookupResult> {
    const outcome = await CompaniesEnrichmentService.lookupOutcome(name);
    if (outcome.status === 'ok') return outcome.result;
    if (outcome.status === 'denied' || outcome.status === 'unavailable') {
      logger.warn({ outcome: outcome.status, detail: outcome.detail }, 'Google Places company lookup failed');
    }
    return { ...EMPTY_LOOKUP };
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

    // Check if we already have an answer. A user-triggered "Re-check Google" (force) re-runs the
    // lookup — including for a company parked on a `denied` result, which is how a workspace
    // recovers after fixing its API key. The automatic paths do not.
    const currentEnrichment = parseEnrichment(company.enrichment);
    if (!force && enrichmentIsSettled(currentEnrichment)) {
      logger.info(`Company ${companyId} already has a Google Places answer on file. Skipping.`);
      return;
    }

    const outcome = await CompaniesEnrichmentService.lookupOutcome(company.name);
    const lookedUpAt = new Date().toISOString();

    if (outcome.status === 'not_configured') {
      // No key, no call, nothing to say. Leaving the row untouched means the company is picked
      // up automatically once a key is configured.
      logger.warn({ companyId, tenantId }, 'Company enrichment skipped: no Google Maps API key configured');
      return;
    }

    if (outcome.status === 'unavailable') {
      // Nothing is written, so the row still looks un-enriched: the job retries with backoff and,
      // if it exhausts its attempts, the daily sweep picks the company up again.
      throw new Error(`Google Places lookup unavailable for company ${companyId}: ${outcome.detail}`);
    }

    if (outcome.status === 'denied') {
      // Recorded, not thrown. Retrying a rejected request changes nothing, and leaving the row
      // blank would have the daily sweep re-queue it forever. `google_enriched` stays unset so
      // nothing claims we have data; the queue guards skip rows in this state, and the recorded
      // detail is queryable so an operator can find every company stuck behind a bad key.
      logger.error(
        { companyId, tenantId, detail: outcome.detail },
        'Google Places refused the enrichment request — company parked until a manual re-check',
      );
      await this.saveEnrichment(companyId, tenantId, {
        ...currentEnrichment,
        google_lookup: { status: 'denied', at: lookedUpAt, detail: outcome.detail },
      });
      return;
    }

    // 'ok' or 'no_match': Google answered. Both are final, so the company is marked enriched and
    // is never re-queued automatically — 'no_match' simply has nothing to copy across.
    const lookup = outcome.status === 'ok' ? outcome.result : { ...EMPTY_LOOKUP };
    const { website, phone, description, industry } = lookup;

    const fields: Updateable<Models['companies']> = {};
    if (!company.website || company.website.trim() === '') {
      fields.website = website;
    }
    if (!company.phone || company.phone.trim() === '') {
      fields.phone = phone;
    }
    if (!company.description || company.description.trim() === '') {
      fields.description = description;
    }
    if (!company.industry || company.industry.trim() === '') {
      fields.industry = industry;
    }

    await this.saveEnrichment(
      companyId,
      tenantId,
      {
        ...currentEnrichment,
        google_enriched: true,
        google_lookup: { status: outcome.status, at: lookedUpAt },
        place_details: outcome.status === 'ok' ? outcome.result : null,
      },
      fields,
    );
  }

  private async saveEnrichment(
    companyId: string,
    tenantId: string,
    enrichment: Record<string, unknown>,
    fields: Updateable<Models['companies']> = {},
  ): Promise<void> {
    await this.db
      .updateTable('companies')
      .set({ ...fields, enrichment: JSON.stringify(enrichment), updated_at: new Date() })
      .where('id', '=', companyId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  /**
   * Enqueue enrichment jobs for companies we have no Google answer for.
   *
   * Called from the daily `refresh_companies_google` cron with no tenant, i.e. across every tenant
   * at once. It used to select every matching row with no limit and write them in one giant insert,
   * and it did not skip companies that already had a pending job — so a backlog re-duplicated the
   * whole queue every single day. Now: a per-run ceiling, batched inserts, and a NOT EXISTS guard.
   * Whatever is left over is simply picked up by tomorrow's run.
   */
  public async queueUnenrichedCompanies(tenantId?: string): Promise<number> {
    // Nothing downstream can succeed without a key, so don't fill the queue with certain no-ops.
    if (!CompaniesEnrichmentService.isConfigured()) {
      logger.warn('Company enrichment sweep skipped: no Google Maps API key configured');
      return 0;
    }

    let query = this.db
      .selectFrom('companies')
      .select(['id', 'tenant_id'])
      .where((eb) => eb.or([eb('enrichment', 'is', null), sql<boolean>`enrichment->>'google_enriched' is null`]))
      // Mirrors enrichmentIsSettled(): a company Google refused to look up is parked until a user
      // presses "Re-check Google", instead of being re-queued every day for the same rejection.
      .where(sql<boolean>`enrichment->'google_lookup'->>'status' is distinct from 'denied'`)
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
