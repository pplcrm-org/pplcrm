import { z } from 'zod';

/**
 * Shape of the companies.enrichment jsonb column (formerly the untyped
 * companies.json grab-bag) — the Google Places enrichment payload.
 * `place_details` is the raw Places API result and deliberately unmodeled.
 */
export const CompanyEnrichmentObj = z
  .object({
    /** Set only when Google actually answered — either with a place, or with "no such place". */
    google_enriched: z.boolean().optional(),
    place_details: z.unknown().optional(),
    /**
     * How the last lookup ended, so a failure is never mistaken for a successful empty result.
     * 'denied' (Google refused the request — usually a bad or blocked API key) is recorded
     * WITHOUT google_enriched: it parks the company so the daily sweep stops re-queueing it,
     * while leaving it obvious that no data was ever retrieved. Pressing "Re-check Google"
     * clears it. Transient failures are not recorded at all — they just retry.
     */
    google_lookup: z
      .object({
        status: z.enum(['ok', 'no_match', 'denied']),
        /** ISO timestamp of the lookup. */
        at: z.string(),
        detail: z.string().optional(),
      })
      .optional(),
  })
  .catchall(z.unknown());

export const CompanyInputObj = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().trim().max(1000).optional().nullable(),
  website: z.string().trim().max(255).optional().nullable().or(z.literal('')),
  email: z.string().trim().max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
});
