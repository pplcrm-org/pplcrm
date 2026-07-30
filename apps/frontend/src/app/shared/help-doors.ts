import { type Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/**
 * Doors from a section of the app into the Help Center article that explains it.
 *
 * Every page carrying a `pc-grid-header` (directly, or through the datagrid) can
 * offer "Read the full guide" without wiring an article id by hand. Keyed by the
 * first URL segment, because that is what identifies a section: `/people/42/edit`
 * and `/people` read the same guide.
 *
 * Ids are Help Center article ids. `help-doors.spec.ts` asserts every one of them
 * resolves, so a renamed article can never leave a dead door behind.
 */
const HELP_DOORS: Readonly<Record<string, string>> = {
  activity: 'activity-log',
  automations: 'automations',
  campaigns: 'campaigns-contexts',
  canvassing: 'canvassing',
  companies: 'companies',
  dashboard: 'dashboard',
  deliveries: 'deliveries',
  'donation-pages': 'donations',
  donations: 'donations',
  duplicates: 'duplicates',
  events: 'events-shifts',
  exports: 'export',
  files: 'files',
  forms: 'forms',
  households: 'households',
  imports: 'import',
  inbox: 'inbox',
  issues: 'tags-issues',
  lists: 'lists',
  newsletters: 'newsletters',
  people: 'add-people',
  profile: 'profile',
  settings: 'settings',
  tags: 'tags-issues',
  tasks: 'tasks',
  teams: 'teams',
  users: 'users-roles',
  'volunteer-access': 'volunteer-access',
  workspace: 'settings',
};

/**
 * The current section's help article as a signal, for anything that outlives a
 * navigation (the navbar, a reused grid component). Empty string = no guide here.
 */
export function injectHelpDoor(): Signal<string> {
  const router = inject(Router);
  const url = toSignal(
    router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: router.url },
  );
  return computed(() => helpArticleForRoute(url()));
}

/** Every article id a door points at, for the integrity spec. */
export const HELP_DOOR_ARTICLE_IDS: string[] = [...new Set(Object.values(HELP_DOORS))];

/**
 * The Help Center article for a router URL, or '' when the section has no guide.
 * Query strings and fragments are ignored; only the leading segment matters.
 */
export function helpArticleForRoute(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const section = path.split('/').filter(Boolean)[0] ?? '';
  return HELP_DOORS[section] ?? '';
}
