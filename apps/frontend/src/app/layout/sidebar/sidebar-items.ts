import type { ModuleId, TermKey } from '@common';
import type { PcIconNameType } from '@icons/icons.index';

export interface ISidebarItem {
  adminOnly?: boolean;
  /**
   * Sibling routes that also light this entry, for a section whose halves are separate
   * top-level routes rather than one route's children (Tags & issues = `/tags` + `/issues`).
   * Matched the same way as `route` — exactly, or as a path prefix.
   */
  alsoActiveFor?: string[];
  /** Live numeric badge (e.g. Tasks' SLA-breach count, Duplicates' queue size). Populated at
   * runtime by Sidebar's `applyBadges` — never part of the static SidebarItems data below. */
  badgeCount?: number | null;
  children?: ISidebarItem[];
  collapsed?: boolean;
  /** Transient: set at runtime by Sidebar when the entry's module is off by the mode's
   * default (no user override). Rendered dimmed; clicking shows a toast pointing at
   * Workspace → Modules instead of navigating. */
  dimmed?: boolean;
  /** Transient: set at runtime by Sidebar when the entry's feature is above the tenant's
   * plan (the shared inbox on Free). Rendered dimmed like an off module, but the click
   * toast and tooltip point at Billing rather than Workspace → Modules. */
  planLocked?: boolean;
  favourite?: boolean;
  hidden?: boolean;
  hiddenByFavourite?: boolean;
  icon?: PcIconNameType;
  indicator?: boolean;
  /** Transient: set on a pin clone so the sidebar plays the `up` entry once. */
  justPinned?: boolean;
  /**
   * Stable identity, never displayed when `termKey` is set. Keyed on by the collapse
   * state, `getItemKey`, the `@for` track expressions and the specs — so a per-mode
   * rename must go through `termKey`, never by mutating this.
   */
  name: string;
  /**
   * Optional module this entry belongs to. When the tenant's MODE leaves the module
   * off by default, Sidebar sets `dimmed` (still visible, so the feature stays
   * discoverable); when the user EXPLICITLY switched it off, Sidebar sets `hidden`.
   * Either way the route still resolves and the `g` chord still works.
   */
  moduleId?: ModuleId;
  parent?: ISidebarItem;
  pathMatchExact?: boolean;
  route?: string;
  /** Per-mode display label. Falls back to `name` when absent. See `sidebarLabel`. */
  termKey?: TermKey;
  /**
   * Second key of the Gmail-style `g` navigation chord (press `g` then this key).
   * A single lowercase letter, unique across all items. Rendered as a hint in the
   * sidebar and consumed by KeyboardShortcutsService to route there.
   */
  shortcut?: string;
  type?: 'item' | 'subheading' | 'bookmark';
}

/**
 * The label to display for an item under the tenant's organization mode.
 *
 * Kept as a free function so every consumer (the sidebar, the `g`-chord help overlay,
 * the tab title, the pin tooltip) resolves a name exactly one way.
 */
export function sidebarLabel(item: Pick<ISidebarItem, 'name' | 'termKey'>, terms: Record<TermKey, string>): string {
  return item.termKey ? terms[item.termKey] : item.name;
}

/**
 * Whether a sidebar item should render highlighted for the given router URL. Prefix-matches so
 * deeper routes keep their section lit (/people/123 keeps People active); `pathMatchExact`
 * items (Dashboard) must match exactly. Query string and fragment are ignored.
 */
export function isSidebarRouteActive(
  url: string,
  nav: Pick<ISidebarItem, 'alsoActiveFor' | 'pathMatchExact' | 'route'>,
): boolean {
  const route = nav.route;
  if (!route) return false;
  const extrasIndex = url.search(/[?#]/);
  const path = extrasIndex === -1 ? url : url.slice(0, extrasIndex);
  const matches = (candidate: string): boolean =>
    nav.pathMatchExact || candidate === '/'
      ? path === candidate
      : path === candidate || path.startsWith(`${candidate}/`);
  return matches(route) || (nav.alsoActiveFor?.some(matches) ?? false);
}

// Sidebar IA follows the North Star module map (spec §0). Section order and
// membership are load-bearing; do not reshuffle without checking the spec.
export const SidebarItems: ISidebarItem[] = [
  {
    name: 'App',
    route: '/',
    hidden: true,
  },
  {
    name: `Dashboard`,
    route: '/dashboard',
    icon: 'presentation-chart-line',
    pathMatchExact: true,
    shortcut: 'h',
  },
  {
    name: `PINS`,
    type: 'bookmark',
    hidden: true,
  },
  {
    name: `WORK`,
    type: 'subheading',
    children: [
      {
        name: 'Inbox',
        route: '/inbox',
        icon: 'envelope',
        shortcut: 'i',
        // badgeCount is populated at runtime by Sidebar from `emails.countAssignedOpen`
        // (open conversations assigned to me — the triage "Mine" count) — see sidebar.ts.
      },
      {
        name: `Tasks`,
        route: '/tasks',
        icon: 'task',
        shortcut: 't',
        // badgeCount is populated at runtime by Sidebar from `tasks.countSlaBreaches`
        // (spec §4) — see sidebar.ts. Static data here is intentionally left unset.
      },
      // Hidden: the board is reachable from the Tasks page via the header swap button
      // (List <-> Board, both at /tasks and /tasks/board) — this entry only keeps the
      // `g b` chord, the pin button and the help overlay working.
      {
        name: `Task board`,
        route: '/board',
        icon: 'view-kanban',
        shortcut: 'b',
        hidden: true,
      },
      {
        name: `People`,
        route: '/people',
        icon: 'identification',
        shortcut: 'p',
      },
      // Hidden: Households and Companies are grains of the People grid (spec §5)
      // reached via the grain tabs; kept here so the `g u` / `g c` chords, the
      // pin button and the help overlay keep working.
      {
        name: `Households`,
        route: '/households',
        icon: 'house-modern',
        // `u` (hoUseholds): `h` is Dashboard (home).
        shortcut: 'u',
        hidden: true,
      },
      {
        name: `Companies`,
        route: '/companies',
        icon: 'briefcase',
        shortcut: 'c',
        hidden: true,
      },
    ],
  },
  {
    name: `OUTREACH`,
    type: 'subheading',
    children: [
      {
        name: 'Newsletters',
        route: '/newsletters',
        icon: 'mailbox',
        shortcut: 'n',
      },
      {
        name: 'Lists',
        route: '/lists',
        icon: 'queue-list',
        shortcut: 'l',
      },
      {
        name: 'Forms',
        route: '/forms',
        icon: 'clipboard-document-list',
        shortcut: 'f',
      },
      {
        name: 'Donations',
        termKey: 'nav.donations',
        moduleId: 'donations',
        route: '/donations',
        icon: 'currency-dollar',
        shortcut: 'd',
      },
      {
        name: `Automations`,
        route: '/automations',
        icon: 'cog',
        shortcut: 'a',
      },
    ],
  },
  {
    // Headed VOLUNTEERS rather than FIELD in every mode: all four entries are
    // volunteer-powered work or volunteer administration, which is equally true of a
    // church, a campaign and a constituency office. Teams is deliberately NOT an
    // optional module, so the section can never empty out.
    name: `VOLUNTEERS`,
    type: 'subheading',
    children: [
      // Wave 2 field surfaces: Canvassing (§13) and Deliveries (§14).
      {
        name: 'Canvassing',
        termKey: 'nav.canvassing',
        moduleId: 'canvassing',
        route: '/canvassing',
        icon: 'route',
        shortcut: 'v',
      },
      {
        name: 'Deliveries',
        termKey: 'nav.deliveries',
        moduleId: 'deliveries',
        route: '/deliveries',
        icon: 'house-modern',
        // `e` (dEliveries): `d` belongs to Donations, and the church-mode wording
        // ("Drop-offs") also starts with a taken letter.
        shortcut: 'e',
        // badgeCount = live approved-and-ready request count (spec §14), populated at runtime by
        // Sidebar from `deliveries.getReadyCount` — see sidebar.ts. Static data left unset.
      },
      {
        name: 'Teams',
        route: '/teams',
        icon: 'user-group',
        // `k`: every letter in "Teams" is taken (`t` is Tasks, `e` Deliveries, `a`
        // Automations, `m` Users, `s` Tags & issues), so this one is arbitrary.
        shortcut: 'k',
      },
      {
        // "Approvals", not "Volunteer access": under a VOLUNTEERS heading the qualifier
        // was redundant, and this is the queue you come here to clear — which is also
        // exactly what the badge counts. ("Access" was rejected: Workspace settings
        // already has a "Teams & access" section.)
        name: 'Approvals',
        moduleId: 'volunteerAccess',
        route: '/volunteer-access',
        // The route itself is role-guarded — without this flag the sidebar and palette offered
        // it to Editors/Viewers whose click silently bounced to the dashboard (REVIEW7 D2).
        adminOnly: true,
        icon: 'identification',
        // `r` (appRovals): `a` belongs to Automations.
        shortcut: 'r',
        // badgeCount = volunteers awaiting approval, populated at runtime by
        // Sidebar from `companionAccess.pendingCount`.
      },
    ],
  },
  {
    name: `DATA`,
    type: 'subheading',
    children: [
      {
        // One entry, two halves of the shared vocabulary: the Tags and Issues pages carry a
        // `pc-tags-issues-nav` tab row between them, so /issues keeps this entry lit.
        name: 'Tags & issues',
        route: '/tags',
        alsoActiveFor: ['/issues'],
        icon: 'label',
        // `s` (tagS & issueS): `t` is Teams, `i` is Inbox, `l` (label) is Lists.
        shortcut: 's',
      },
      {
        // Wave 1E (spec §17): History page with Imports/Exports tabs, plus the
        // CSV import wizard at /imports/new. Exports' standalone entry folded
        // in here — see the redirect in dashboard.routes.ts.
        name: 'Import & export',
        route: '/imports',
        icon: 'arrows-up-down-tray',
        // `x` (eXport, the usual key for it): `i` is Inbox.
        shortcut: 'x',
      },
      {
        name: `Duplicates`,
        route: '/duplicates',
        icon: 'document-duplicate',
        // `q` (merge Queue, which is what the badge below counts): `d` is Donations.
        shortcut: 'q',
        // Badge = merge-queue size (spec §9.3), via the tenant-scoped `duplicates.countQueue`
        // query. Count is fetched and applied in Sidebar (sidebar.ts) — see `badgeCount`.
      },
    ],
  },
  {
    name: `ADMIN`,
    type: 'subheading',
    adminOnly: true,
    collapsed: true,
    children: [
      {
        name: 'Users',
        route: '/users',
        icon: 'users',
        // `m` (workspace Members): `u` is Households and `s` is Tags & issues.
        shortcut: 'm',
      },

      {
        name: 'Activity',
        route: '/activity',
        icon: 'clipboard-document-list',
        // `y` (activitY): `a` is Automations, `c` is Companies, `t` is Teams.
        shortcut: 'y',
      },
      {
        name: 'Workspace',
        route: '/workspace',
        icon: 'wrench-screwdriver',
        shortcut: 'w',
      },
    ],
  },
];
