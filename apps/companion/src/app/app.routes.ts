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
 */
export const appRoutes: Route[] = [
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
    path: '**',
    loadComponent: () => import('./gate/dead-link-page').then((m) => m.DeadLinkPage),
  },
];
