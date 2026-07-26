/** Plan a stop needs, shown as a chip so the ceiling is honest rather than discovered later. */
export type TourPlanChip = 'Grassroots' | 'Movement' | null;

export interface TourStop {
  id: string;
  /** Route the tour navigates to before showing the bubble. Null keeps the current page. */
  route: string | null;
  /**
   * Id of the element to spotlight, matched by `pcTourAnchor`. Null renders the bubble centred,
   * which is what the opening and closing stops want.
   */
  anchor: string | null;
  title: string;
  body: string;
  /** Alternative body for viewers, who cannot do the thing the default copy suggests. */
  viewerBody?: string;
  planChip: TourPlanChip;
}

/**
 * Seven stops, not twenty.
 *
 * Tours are abandoned by length, and an abandoned tour teaches nothing — so forms, donations,
 * tasks, imports, deliveries and automations are deliberately absent. The last stop teaches the
 * command palette instead, which finds all of them: teach the finder, not the list.
 *
 * Every stop lands on data the signup seeder actually created, which is why the tour only runs in
 * demo mode. A tour of an empty CRM can only point at furniture.
 */
export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: 'welcome',
    route: '/dashboard',
    anchor: null,
    title: 'Take a two-minute look around',
    body:
      'Your workspace is loaded with realistic sample data: people and households across Ottawa, a sent ' +
      'newsletter with its full report, canvassing turfs, and three demo teammates. Everything here is safe ' +
      'to open, edit, and delete.',
    planChip: null,
  },
  {
    id: 'people',
    route: '/people',
    anchor: 'nav-people',
    title: 'Everyone you know, in one grid',
    body:
      'The sidebar counts are live. Filters are always visible as chips with a count sentence, so you can ' +
      'see what you are looking at before you click. Try double-clicking a cell to edit it in place.',
    viewerBody:
      'The sidebar counts are live. Filters are always visible as chips with a count sentence, so you can ' +
      'see what you are looking at before you click, and sort or search without changing anything.',
    planChip: null,
  },
  {
    id: 'person',
    route: '/people',
    // No anchor: spotlighting a specific grid row would mean the tour reaching into the
    // datagrid's internals for one stop. The bubble sits centred over the grid instead.
    anchor: null,
    title: 'A record is a relationship, not a row',
    body:
      'Open anyone to see their household, tags, issues, support level and full history on one page. ' +
      'The name is always the door.',
    planChip: null,
  },
  {
    id: 'lists',
    route: '/lists',
    anchor: 'nav-lists',
    title: 'Segments that maintain themselves',
    body:
      'A smart list is a saved question, not a saved answer. Define it once and it keeps matching as people ' +
      'change. Your All Subscribers and All Volunteers lists work this way and cannot be deleted.',
    planChip: 'Grassroots',
  },
  {
    id: 'newsletter',
    route: '/newsletters',
    anchor: 'nav-newsletters',
    title: 'Send, then see who actually read it',
    body:
      'One newsletter was already "sent" for you, so its report has real numbers. Openers become a list you ' +
      'can follow up with in two clicks. Sending stays locked while you are in demo mode.',
    planChip: 'Grassroots',
  },
  {
    id: 'canvassing',
    route: '/canvassing',
    anchor: 'nav-canvassing',
    title: 'The part a generic CRM cannot do',
    body:
      'Cut a neighbourhood into turfs, send volunteers out with a link that needs no account, and watch ' +
      'knocks land on the map as they happen.',
    planChip: 'Movement',
  },
  {
    id: 'finding',
    route: '/dashboard',
    anchor: null,
    title: 'Finding everything else',
    body:
      'Press ⌘K (Ctrl+K on Windows) to jump anywhere: forms, donations, tasks, imports, deliveries, ' +
      'automations. When you are ready to make this workspace yours, "Set up my workspace" on this page ' +
      'walks you through it.',
    planChip: null,
  },
];
