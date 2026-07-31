/**
 * Data residency — the region a workspace's records are stored in.
 *
 * Asked at signup rather than later because moving a live workspace between regions is a
 * data migration, not a settings change: once contacts, email bodies, attachments and
 * backups exist, "where does this live" stops being a question anyone can answer with a
 * dropdown. Stored on `tenants.data_region` (a provisioning fact about the workspace,
 * alongside `slug` and `approval_status`) rather than in the `settings` key/value table,
 * which holds presentation preferences.
 *
 * TWO SEPARATE SETS, and mixing them up is the bug this file exists to prevent:
 *  - {@link DATA_REGION_CHOICES} — the four answers the signup form accepts, including
 *    'any', which means "I have no requirement". This is what the column stores.
 *  - {@link DATA_REGIONS} — the three actual places data can sit. 'any' is not one of them.
 * Use {@link hostingRegionFor} to cross from a choice to a place; never assume a stored
 * choice names a location.
 *
 * NOT the same thing as the DONATION residency restriction (`donations.residency_acknowledged`
 * and the donor-eligibility rules in modules/donations) — that one is about which donors an
 * organization is legally allowed to accept money from, and has nothing to do with hosting.
 * Never import both into one file without aliasing.
 */

/** The three places data can actually be stored. */
export const DATA_REGIONS = ['ca', 'us', 'eu'] as const;

export type DataRegion = (typeof DATA_REGIONS)[number];

/**
 * The answer meaning "I have no requirement about where my data lives" — the default, and
 * the only answer that costs nothing (see {@link DATA_RESIDENCY_MIN_PLAN} in ./billing/plans.ts).
 * Most organizations have no residency requirement, and asking them to pick a country they
 * have no opinion about would make a paid feature look mandatory.
 */
export const NO_REGION_PREFERENCE = 'any';

/** Everything the signup picker offers: no preference, plus the three real regions. */
export const DATA_REGION_CHOICES = [NO_REGION_PREFERENCE, ...DATA_REGIONS] as const;

export type DataRegionChoice = (typeof DATA_REGION_CHOICES)[number];

/** What a signup that never answered gets, and what every workspace created before this
 * question existed is backfilled to. */
export const DEFAULT_DATA_REGION_CHOICE: DataRegionChoice = NO_REGION_PREFERENCE;

/** The region the platform actually runs in, and therefore where a workspace with no
 * preference (or an unfulfillable one) is stored. */
export const DEFAULT_DATA_REGION: DataRegion = 'ca';

export function isDataRegion(value: unknown): value is DataRegion {
  return typeof value === 'string' && (DATA_REGIONS as readonly string[]).includes(value);
}

export function isDataRegionChoice(value: unknown): value is DataRegionChoice {
  return typeof value === 'string' && (DATA_REGION_CHOICES as readonly string[]).includes(value);
}

/** True when the customer named a specific region. This — not the region itself — is what
 * the Movement plan is required for. */
export function hasRegionPreference(choice: DataRegionChoice): boolean {
  return choice !== NO_REGION_PREFERENCE;
}

export const DATA_REGION_CHOICE_LABELS: Record<DataRegionChoice, string> = {
  any: 'Does not matter',
  ca: 'Canada',
  us: 'United States',
  eu: 'European Union',
};

/** Second line under the signup picker — what the choice actually decides, in the user's terms. */
export const DATA_REGION_CHOICE_DESCRIPTIONS: Record<DataRegionChoice, string> = {
  any: 'We store your data wherever we run. Today that is Canada.',
  ca: 'Stored and backed up in Canada. Subject to PIPEDA.',
  us: 'Stored and backed up in the United States.',
  eu: 'Stored and backed up in the European Union. Subject to the GDPR.',
};

/**
 * The regions that have hosting standing up right now.
 *
 * Everything runs in one Azure region (Canada Central) — `infra/azure/README.md` and
 * `deploy/GO-LIVE-CHECKLIST.md` §12 both record that multi-region tenant routing is an
 * undesigned, deferred task. A workspace that picks `us` or `eu` therefore has its choice
 * RECORDED but its data stored in Canada, and the signup form says so rather than making a
 * promise the infrastructure cannot keep.
 *
 * DANGER — adding a region to this list is not a one-line change. The moment `eu` appears
 * here, {@link hostingRegionFor} starts reporting that every tenant who ever picked `eu` is
 * hosted in the EU, including the ones whose rows are still sitting in Canada. Whoever opens
 * a region owes, in the same change: the regional infrastructure, the tenant-routing design,
 * and a migration that actually moves the already-signed-up tenants who chose it.
 */
export const LIVE_DATA_REGIONS: readonly DataRegion[] = ['ca'];

export function isDataRegionLive(region: DataRegion): boolean {
  return LIVE_DATA_REGIONS.includes(region);
}

/**
 * True when the customer asked for a specific region that has no hosting yet — the case the
 * signup form has to disclose, and the one an operator has to follow up on.
 */
export function isChoicePendingRegion(choice: DataRegionChoice): boolean {
  return isDataRegion(choice) && !isDataRegionLive(choice);
}

/**
 * Where a workspace's data physically sits, given the answer it gave. 'no preference' and any
 * region whose hosting is not open yet both resolve to the region the platform runs in.
 *
 * Use this — never the raw `data_region` column — anywhere the answer must be true rather
 * than aspirational: the privacy/export copy shown to a user, a data-processing record, or
 * anything that picks a storage endpoint.
 */
export function hostingRegionFor(choice: DataRegionChoice): DataRegion {
  return isDataRegion(choice) && isDataRegionLive(choice) ? choice : DEFAULT_DATA_REGION;
}
