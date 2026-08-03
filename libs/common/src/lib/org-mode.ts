/**
 * Organization mode — the tenant's answer to "what kind of organization is this?".
 *
 * A mode is a PRESENTATION PREFERENCE and nothing more. It picks the wording for a
 * handful of navigation labels and decides which optional modules start out in the
 * sidebar. It never gates data, never gates the API, and never makes a module
 * unreachable — every module stays routable and can be switched back on in
 * Workspace → Modules. Entitlement is the plan gate's job (GATED_FEATURES in
 * ./billing/plans.ts); the two are orthogonal and compose.
 *
 * NAMING TRAP: `OrgMode` values 'office' and 'campaign' look like — and are NOT —
 * `CAMPAIGN_KINDS = ['office','election']` from ./schemas/campaigns.schema.ts, which
 * types the `campaigns` DB entity. A tenant in 'church' mode still has an `office`
 * campaign row. Never import both symbol sets into one file without aliasing.
 *
 * Stored per tenant in the `settings` key/value table under the two keys below, and
 * mirrored onto the session user (`IAuthUser.tenant_org_mode`) so the sidebar can
 * resolve a label before the settings snapshot has loaded.
 */

export const ORG_MODES = ['office', 'campaign', 'nonprofit', 'church'] as const;

export type OrgMode = (typeof ORG_MODES)[number];

/** What an existing workspace is, and what a signup without a `?for=` hint gets. */
export const DEFAULT_ORG_MODE: OrgMode = 'office';

/** `settings.key` holding the mode. Value is a bare JSON string, e.g. `"church"`. */
export const ORG_MODE_SETTINGS_KEY = 'workspace.mode';

/** `settings.key` holding the sparse module override map (see `isModuleEnabled`). */
export const MODULE_VISIBILITY_SETTINGS_KEY = 'workspace.modules';

export function isOrgMode(value: unknown): value is OrgMode {
  return typeof value === 'string' && (ORG_MODES as readonly string[]).includes(value);
}

export const ORG_MODE_LABELS: Record<OrgMode, string> = {
  office: 'Constituency office',
  campaign: 'Political campaign',
  nonprofit: 'Non-profit',
  church: 'Church',
};

/** Second line on the Workspace -> Modules picker cards — what the mode changes, in the user's terms. */
export const ORG_MODE_DESCRIPTIONS: Record<OrgMode, string> = {
  office: 'Casework, constituents, and year-round outreach.',
  campaign: 'Doors, turfs, sign drops, and election-day pushes.',
  nonprofit: 'Supporters, giving, and program outreach.',
  church: 'Congregation, giving, and serving teams.',
};

/**
 * The wording that changes with the mode.
 *
 * Deliberately tiny. A key earns its place only if the word is WRONG in some mode
 * (not merely not-what-they'd-have-picked) and it labels a fixed site — a nav entry
 * or a section heading — rather than being woven through prose. That rules out
 * People, Households, Tasks, Inbox, Lists, Forms, Newsletters, Automations, Teams,
 * and every section heading, all of which read fine everywhere.
 *
 * Two things that look like they belong here and don't:
 *  - The section holding these entries is headed VOLUNTEERS in every mode. All of its
 *    entries are volunteer-powered work or volunteer administration, which is equally
 *    true of a church, a campaign, and a constituency office.
 *  - The companion-access page is headed "Approvals" in every mode. Under a VOLUNTEERS
 *    heading "Volunteer access" was redundant, and "Approvals" names the queue you
 *    actually go there to clear (it is also what the sidebar badge counts). "Access"
 *    was rejected: the Workspace settings already have a "Teams & access" section.
 */
export const TERM_KEYS = ['nav.canvassing', 'nav.deliveries', 'nav.donations'] as const;

export type TermKey = (typeof TERM_KEYS)[number];

/**
 * Total, not partial: every mode supplies every key. A missing string is a compile
 * error rather than a runtime hole, so no consumer needs a `??` fallback chain.
 *
 * `office` used to be byte-identical to the shipped pre-modes sidebar, as the default
 * mode's regression guard. It deliberately is not any more: "Canvassing" is electoral
 * vote-ID language, and a constituency office knocks year-round without an election on.
 * The guard that replaced it is the migration that stamps every pre-existing workspace's
 * module overrides (2026-07-29-office-mode-differentiation.ts) — wording may change under
 * an existing workspace, but its sidebar CONTENTS may not.
 */
export const ORG_MODE_TERMS: Record<OrgMode, Record<TermKey, string>> = {
  office: {
    'nav.canvassing': 'Door knocking',
    'nav.deliveries': 'Deliveries',
    'nav.donations': 'Donations',
  },
  campaign: {
    'nav.canvassing': 'Canvassing',
    'nav.deliveries': 'Deliveries',
    'nav.donations': 'Donations',
  },
  nonprofit: {
    'nav.canvassing': 'Outreach visits',
    'nav.deliveries': 'Deliveries',
    'nav.donations': 'Donations',
  },
  church: {
    'nav.canvassing': 'Visitation',
    'nav.deliveries': 'Drop-offs',
    'nav.donations': 'Giving',
  },
};

export function termFor(mode: OrgMode, key: TermKey): string {
  return ORG_MODE_TERMS[mode][key];
}

/**
 * Modules a mode may leave out of the sidebar by default. Everything not listed here
 * is always present — a mode never hides the Inbox.
 */
export const OPTIONAL_MODULES = ['canvassing', 'deliveries', 'donations', 'volunteerAccess'] as const;

export type ModuleId = (typeof OPTIONAL_MODULES)[number];

/**
 * Where each mode starts.
 *
 * `office` starts with donations OFF: a publicly-funded constituency office does not
 * fundraise — the riding association / EDA does, and it is a separate legal entity with
 * its own books. An office that also runs its association's finances turns Donations back
 * on in Workspace → Modules; nothing is deleted or unreachable either way.
 *
 * BEWARE, `office` is `DEFAULT_ORG_MODE`: every workspace created before modes existed has
 * no `workspace.mode` row and resolves here. Because the override map is SPARSE
 * (`isModuleEnabled`), flipping a default to false silently removes the nav entry from
 * every one of those workspaces. `2026-07-29-office-mode-differentiation.ts` stamps
 * `{donations: true}` into their overrides for exactly that reason. Flip another default
 * and you owe the same backfill.
 */
export const ORG_MODE_MODULE_DEFAULTS: Record<OrgMode, Record<ModuleId, boolean>> = {
  office: { canvassing: true, deliveries: true, donations: false, volunteerAccess: true },
  campaign: { canvassing: true, deliveries: true, donations: true, volunteerAccess: true },
  nonprofit: { canvassing: false, deliveries: false, donations: true, volunteerAccess: true },
  church: { canvassing: false, deliveries: false, donations: true, volunteerAccess: true },
};

/**
 * Who decided a module is off: nobody ('on'), the mode's default ('offByMode'), or the
 * user's explicit override ('offByUser'). The distinction matters to the sidebar:
 * off-by-mode entries stay visible but dimmed (the user may not know the module exists),
 * off-by-user entries are hidden (they made that call).
 */
export type ModuleVisibility = 'on' | 'offByMode' | 'offByUser';

/**
 * Resolve a module's visibility: an explicit user decision wins, otherwise the mode's
 * default applies.
 *
 * The override map is SPARSE on purpose — it records only what the user actually
 * toggled. Switching modes later re-applies the new mode's defaults to everything
 * they never touched, while still honouring the ones they did. A full snapshot would
 * silently freeze the old mode's defaults forever.
 */
export function moduleVisibility(
  mode: OrgMode,
  id: ModuleId,
  overrides?: Partial<Record<ModuleId, boolean>> | null,
): ModuleVisibility {
  const override = overrides?.[id];
  if (typeof override === 'boolean') return override ? 'on' : 'offByUser';
  return ORG_MODE_MODULE_DEFAULTS[mode][id] ? 'on' : 'offByMode';
}

/** Collapse of `moduleVisibility` for callers that only care whether the module is on. */
export function isModuleEnabled(
  mode: OrgMode,
  id: ModuleId,
  overrides?: Partial<Record<ModuleId, boolean>> | null,
): boolean {
  return moduleVisibility(mode, id, overrides) === 'on';
}

/** Narrow an untrusted settings value into a sparse override map. */
export function parseModuleOverrides(value: unknown): Partial<Record<ModuleId, boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const parsed: Partial<Record<ModuleId, boolean>> = {};
  for (const id of OPTIONAL_MODULES) {
    if (typeof raw[id] === 'boolean') parsed[id] = raw[id];
  }
  return parsed;
}

/**
 * Whether a mode runs elections. Exactly one question, asked in three places: whether a person
 * carries a support level and a voting status (`person-campaign-facts`), whether the Campaigns
 * settings section — which is where you add and archive ELECTION contexts — appears at all, and
 * whether signup seeds the electoral starter vocabulary ("new resident", the issues survey).
 *
 * It is NOT "is this a campaign". Lawn signs and the yard-sign request form used to hang off this
 * flag, which handed a constituency office a sign operation it has no candidate for; they now live
 * in the campaign column of `MODE_EXTRA_TAGS` / `MODE_STARTER_FORMS` (backend onboarding-seed.ts).
 *
 * Kept apart from ORG_MODE_SEEDS_DEMO below on purpose. The two used to be one flag, which was
 * fine while only electoral modes had a demo dataset; once a church seeds a demo workspace, one
 * flag would hand it lawn-sign tags. What each mode CAN organize and whether it happens to have
 * sample data are unrelated questions.
 */
export const ORG_MODE_IS_ELECTORAL: Record<OrgMode, boolean> = {
  office: true,
  campaign: true,
  nonprofit: false,
  church: false,
};

/**
 * Whether a mode's signup seeds a demo dataset.
 *
 * Mirrors `DEMO_DATASETS` in `apps/backend/src/app/modules/demo/demo-datasets.ts`, which is the
 * real registry; this copy exists because the frontend (the tour) needs the answer and cannot
 * import backend code. `demo-datasets.spec.ts` asserts the two agree, so a mode gaining a dataset
 * without gaining its tour — or the reverse — fails a test rather than shipping.
 *
 * All four true: every new workspace opens with sample data written for the kind of organization
 * it is, which is what the marketing site and the help centre both state.
 */
export const ORG_MODE_SEEDS_DEMO: Record<OrgMode, boolean> = {
  office: true,
  campaign: true,
  nonprofit: true,
  church: true,
};
