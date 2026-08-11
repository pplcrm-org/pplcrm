import { ORG_MODES, type OrgMode } from '@common';

import { environment } from '../../environments/environment';

export interface NavLink {
  readonly label: string;
  /** Internal router path. */
  readonly path: string;
}

export interface AudienceNavLink extends NavLink {
  readonly id: OrgMode;
}

/**
 * Where each audience's landing page lives. A TOTAL Record keyed by `OrgMode`, so adding an
 * organization type to the app is a compile error here until the site has a page for it.
 *
 * The paths are the historical plurals and must not change — they are indexed, and they are
 * listed in `MARKETING_PATHS` (tools/generate-help-static.ts) which feeds the sitemap.
 */
const AUDIENCE_BY_ID: Record<OrgMode, NavLink> = {
  office: { label: 'Constituency offices', path: '/for/offices' },
  campaign: { label: 'Campaigns', path: '/for/campaigns' },
  nonprofit: { label: 'Non-profits', path: '/for/nonprofits' },
  church: { label: 'Churches', path: '/for/churches' },
};

/**
 * The four audience landing pages, in `ORG_MODES` order. One source for the header dropdown, the
 * mobile menu and the footer's Industries column — those used to be three hand-maintained copies.
 *
 * Labels here are PLURAL ("Campaigns"); the hero's "I'm a…" picker uses the singular form from
 * `AUDIENCE_CONTENT[id].pickerLabel`, because the two surfaces read as different sentences.
 */
export const AUDIENCE_NAV: readonly AudienceNavLink[] = ORG_MODES.map((id) => ({ id, ...AUDIENCE_BY_ID[id] }));

export function audiencePath(id: OrgMode): string {
  return AUDIENCE_BY_ID[id].path;
}

/**
 * The deep feature pages, in one array so the header's "Features" dropdown, the mobile menu
 * group and the footer's Product column cannot drift apart — the same discipline
 * `AUDIENCE_NAV` uses for the audience links.
 */
export const FEATURE_NAV: readonly NavLink[] = [
  { label: 'Canvassing & turfs', path: '/canvassing' },
  { label: 'Yard signs & deliveries', path: '/deliveries' },
  { label: 'Ridings & districts', path: '/districts' },
];

/**
 * Everything else in the primary nav. The audience links moved into a "Who it's for" dropdown —
 * at `lg` the row already carried five links plus the currency switcher and both auth buttons,
 * and a fourth audience did not fit. The feature pages live in a second dropdown
 * (`FeatureMenu`) for the same reason.
 */
export const PRIMARY_NAV: readonly NavLink[] = [
  { label: 'Compare', path: '/compare' },
  { label: 'Pricing', path: '/pricing' },
];

/**
 * The CRM lives on a separate host (see environment.appUrl). "Log in" and
 * "Start free" leave the marketing site for the app, so they are absolute URLs,
 * not router links.
 */
export const LOGIN_URL = `${environment.appUrl}/signin`;
export const SIGNUP_URL = `${environment.appUrl}/signup`;
// Signed-in visitors go straight to the app (its root redirects to the dashboard).
export const DASHBOARD_URL = environment.appUrl;

/**
 * Signup URL that carries the visitor's audience through. The signup form reads `?for=` and
 * preselects that organization type, which decides the starter tags, starter forms and whether
 * the demo dataset is seeded — so a church visitor never has to answer the question twice.
 */
export function signupUrlFor(audience: OrgMode): string {
  return `${SIGNUP_URL}?for=${audience}`;
}
