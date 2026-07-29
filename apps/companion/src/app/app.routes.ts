import type { Route } from '@angular/router';

/**
 * Routable surfaces of the companion app. Everything else (view state inside an app) is
 * client-side only.
 *
 * Two are capability tokens (`/t`, `/r`) and two are not: `/j/:code` is a shareable join
 * code that grants nothing on its own, and `/canvass` carries no URL credential at all —
 * the device session is the credential. `/canvass` exists because turf tokens are
 * hashed: once a volunteer joins by QR there is no `/t/:token` URL that can be handed
 * back to them, so the app needs a door that opens on identity rather than on a link.
 *
 * The root is a typeable-code page rather than a redirect or the catch-all, because the
 * join QR card in the CRM tells volunteers to enter their code at the bare host.
 *
 * Two more are staff-facing, and land here rather than in the CRM because a phone opening
 * an SMS link should not meet a sign-in wall or a desktop layout: `/a/:token` approves one
 * volunteer, `/o/:token` is the organizer's launch page (the join QR plus everyone who has
 * scanned it). Both are bearer tokens, scoped narrowly and short-lived.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./gate/home-page').then((m) => m.HomePage),
  },
  {
    path: 't/:token',
    loadComponent: () => import('./canvass/canvass-page').then((m) => m.CanvassPage),
  },
  {
    path: 'canvass',
    loadComponent: () => import('./canvass/canvass-page').then((m) => m.CanvassPage),
  },
  {
    path: 'r/:token',
    loadComponent: () => import('./deliveries/route-page').then((m) => m.RoutePage),
  },
  {
    path: 'j/:code',
    loadComponent: () => import('./gate/join-page').then((m) => m.JoinPage),
  },
  {
    path: 'a/:token',
    loadComponent: () => import('./gate/approve-page').then((m) => m.ApprovePage),
  },
  {
    path: 'o/:token',
    loadComponent: () => import('./gate/organizer-page').then((m) => m.OrganizerPage),
  },
  {
    path: '**',
    loadComponent: () => import('./gate/dead-link-page').then((m) => m.DeadLinkPage),
  },
];
