import type { ISidebarItem } from './sidebar-items';
import { SidebarItems, isSidebarRouteActive } from './sidebar-items';

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
