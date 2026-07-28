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
  favourite?: boolean;
  hidden?: boolean;
  hiddenByFavourite?: boolean;
  icon?: PcIconNameType;
  indicator?: boolean;
  /** Transient: set on a pin clone so the sidebar plays the `up` entry once. */
  justPinned?: boolean;
  name: string;
  parent?: ISidebarItem;
  pathMatchExact?: boolean;
  route?: string;
  /**
   * Second key of the Gmail-style `g` navigation chord (press `g` then this key).
   * A single lowercase letter, unique across all items. Rendered as a hint in the
   * sidebar and consumed by KeyboardShortcutsService to route there.
   */
  shortcut?: string;
  type?: 'item' | 'subheading' | 'bookmark';
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
        shortcut: 'k',
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
        route: '/donations',
        icon: 'currency-dollar',
        shortcut: 'o',
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
    name: `FIELD`,
    type: 'subheading',
    children: [
      // Wave 2 FIELD surfaces: Canvassing (§13) and Deliveries (§14).
      {
        name: 'Canvassing',
        route: '/canvassing',
        icon: 'route',
        shortcut: 'v',
      },
      {
        name: 'Deliveries',
        route: '/deliveries',
        icon: 'house-modern',
        // badgeCount = live approved-and-ready request count (spec §14), populated at runtime by
        // Sidebar from `deliveries.getReadyCount` — see sidebar.ts. Static data left unset.
      },
      {
        name: 'Teams',
        route: '/teams',
        icon: 'user-group',
        shortcut: 't',
      },
      {
        name: 'Volunteer access',
        route: '/volunteer-access',
        icon: 'identification',
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
        // Wave 1E (spec §17): History page with Imports/Exports tabs, plus the
        // CSV import wizard at /imports/new. Exports' standalone entry folded
        // in here — see the redirect in dashboard.routes.ts.
        name: 'Import / export',
        route: '/imports',
        icon: 'arrows-up-down-tray',
      },
      {
        name: `Duplicates`,
        route: '/duplicates',
        icon: 'document-duplicate',
        shortcut: 'd',
        // Badge = merge-queue size (spec §9.3), via the tenant-scoped `duplicates.countQueue`
        // query. Count is fetched and applied in Sidebar (sidebar.ts) — see `badgeCount`.
      },
      {
        // One entry, two halves of the shared vocabulary: the Tags and Issues pages carry a
        // `pc-tags-issues-nav` tab row between them, so /issues keeps this entry lit.
        name: 'Tags & issues',
        route: '/tags',
        alsoActiveFor: ['/issues'],
        icon: 'label',
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
      },

      {
        name: 'Activity',
        route: '/activity',
        icon: 'clipboard-document-list',
      },
      {
        name: 'Workspace',
        route: '/workspace',
        icon: 'wrench-screwdriver',
      },
    ],
  },
];
