import { ORG_MODES, ORG_MODE_TERMS, OPTIONAL_MODULES, TERM_KEYS } from '@common';

import type { ISidebarItem } from './sidebar-items';
import { SidebarItems, isSidebarRouteActive, sidebarLabel } from './sidebar-items';

/** Flatten the sidebar tree (top-level items plus their children) into a single list. */
function flatten(items: ISidebarItem[]): ISidebarItem[] {
  return items.flatMap((item) => (item.children ? [item, ...flatten(item.children)] : [item]));
}

describe('SidebarItems', () => {
  const all = flatten(SidebarItems);
  const navigable = all.filter((item) => item.type !== 'subheading' && item.type !== 'bookmark' && !item.hidden);

  it('gives every navigable item a non-empty route', () => {
    for (const item of navigable) {
      expect(item.route, `item "${item.name}" is missing a route`).toBeTruthy();
    }
  });

  it('gives every navigable item an icon', () => {
    for (const item of navigable) {
      expect(item.icon, `item "${item.name}" is missing an icon`).toBeTruthy();
    }
  });

  it('does not repeat the same route across entries', () => {
    const routes = navigable.map((item) => item.route);
    const unique = new Set(routes);
    expect(unique.size).toBe(routes.length);
  });

  it('uses a unique single lowercase letter for every navigation shortcut', () => {
    const withShortcut = all.filter((item) => item.shortcut != null);
    for (const item of withShortcut) {
      expect(item.shortcut, `item "${item.name}" has a malformed shortcut`).toMatch(/^[a-z]$/);
      expect(item.route, `item "${item.name}" has a shortcut but no route`).toBeTruthy();
    }
    const keys = withShortcut.map((item) => item.shortcut);
    expect(new Set(keys).size, 'sidebar shortcut keys must be unique').toBe(keys.length);
  });

  it('marks the admin-only ADMIN section as adminOnly', () => {
    const admin = SidebarItems.find((item) => item.name === 'ADMIN');
    expect(admin?.adminOnly).toBe(true);
  });

  it('includes the Dashboard entry pointing at /dashboard with exact path matching', () => {
    const dashboard = SidebarItems.find((item) => item.name === 'Dashboard');
    expect(dashboard?.route).toBe('/dashboard');
    expect(dashboard?.pathMatchExact).toBe(true);
  });

  it('hides the internal App root entry from the visible sidebar', () => {
    const appEntry = SidebarItems.find((item) => item.name === 'App');
    expect(appEntry?.hidden).toBe(true);
  });

  describe('organization-mode wiring', () => {
    it('points every termKey at a real entry in the term table', () => {
      for (const item of all) {
        if (!item.termKey) continue;
        expect(TERM_KEYS, `"${item.name}" has an unknown termKey`).toContain(item.termKey);
      }
    });

    it('points every moduleId at a real optional module', () => {
      for (const item of all) {
        if (!item.moduleId) continue;
        expect(OPTIONAL_MODULES, `"${item.name}" has an unknown moduleId`).toContain(item.moduleId);
      }
    });

    /** Every module a mode can switch off must be reachable, or it can never be switched on. */
    it('gives every optional module exactly one sidebar entry', () => {
      for (const id of OPTIONAL_MODULES) {
        const owners = all.filter((item) => item.moduleId === id);
        expect(owners.length, `module "${id}" should have exactly one entry`).toBe(1);
        expect(owners[0].route, `module "${id}" needs a route`).toBeTruthy();
      }
    });

    it('resolves a label for every item in every mode', () => {
      for (const mode of ORG_MODES) {
        for (const item of all) {
          expect(sidebarLabel(item, ORG_MODE_TERMS[mode]).trim(), `${mode}/${item.name}`).not.toBe('');
        }
      }
    });

    it('falls back to name for an item with no termKey', () => {
      expect(sidebarLabel({ name: 'Teams' }, ORG_MODE_TERMS.church)).toBe('Teams');
    });

    it('words the mode-sensitive entries from the table', () => {
      const canvassing = all.find((item) => item.moduleId === 'canvassing');
      expect(canvassing).toBeDefined();
      expect(sidebarLabel(canvassing!, ORG_MODE_TERMS.campaign)).toBe('Canvassing');
      expect(sidebarLabel(canvassing!, ORG_MODE_TERMS.church)).toBe('Visitation');
    });
  });
});

describe('isSidebarRouteActive', () => {
  const people: Pick<ISidebarItem, 'pathMatchExact' | 'route'> = { route: '/people' };
  const dashboard: Pick<ISidebarItem, 'pathMatchExact' | 'route'> = { route: '/dashboard', pathMatchExact: true };

  it('matches the exact route', () => {
    expect(isSidebarRouteActive('/people', people)).toBe(true);
  });

  it('keeps the section lit on deeper routes (grid -> detail view)', () => {
    expect(isSidebarRouteActive('/people/123', people)).toBe(true);
    expect(isSidebarRouteActive('/people/amira-hassan', people)).toBe(true);
    expect(isSidebarRouteActive('/people/123/edit', people)).toBe(true);
  });

  it('does not treat a sibling route sharing the prefix as active', () => {
    expect(isSidebarRouteActive('/peoplex', people)).toBe(false);
    expect(isSidebarRouteActive('/tasks', people)).toBe(false);
  });

  it('ignores query string and fragment', () => {
    expect(isSidebarRouteActive('/people?view=grid#top', people)).toBe(true);
    expect(isSidebarRouteActive('/people/123?tab=notes', people)).toBe(true);
  });

  it('requires an exact match when pathMatchExact is set', () => {
    expect(isSidebarRouteActive('/dashboard', dashboard)).toBe(true);
    expect(isSidebarRouteActive('/dashboard/foo', dashboard)).toBe(false);
  });

  it('never prefix-matches the root route', () => {
    const root: Pick<ISidebarItem, 'pathMatchExact' | 'route'> = { route: '/' };
    expect(isSidebarRouteActive('/', root)).toBe(true);
    expect(isSidebarRouteActive('/people', root)).toBe(false);
  });

  it('is never active without a route', () => {
    expect(isSidebarRouteActive('/people', { route: undefined })).toBe(false);
  });

  // Tags & issues is one entry over two sibling top-level routes; /issues must keep it lit.
  it('stays lit on a sibling route listed in alsoActiveFor', () => {
    const vocabulary: Pick<ISidebarItem, 'alsoActiveFor' | 'pathMatchExact' | 'route'> = {
      route: '/tags',
      alsoActiveFor: ['/issues'],
    };
    expect(isSidebarRouteActive('/tags', vocabulary)).toBe(true);
    expect(isSidebarRouteActive('/issues', vocabulary)).toBe(true);
    expect(isSidebarRouteActive('/issues/42', vocabulary)).toBe(true);
    expect(isSidebarRouteActive('/issuesx', vocabulary)).toBe(false);
    expect(isSidebarRouteActive('/lists', vocabulary)).toBe(false);
  });

  it('lights the real Tags & issues entry on both of its routes', () => {
    const entry = flatten(SidebarItems).find((item) => item.name === 'Tags & issues');
    expect(entry, 'the merged Tags & issues sidebar entry is missing').toBeTruthy();
    expect(entry && isSidebarRouteActive('/tags', entry)).toBe(true);
    expect(entry && isSidebarRouteActive('/issues', entry)).toBe(true);
  });
});
