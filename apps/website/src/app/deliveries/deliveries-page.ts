import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  DRIVER_MOCK,
  LIMITS,
  PANEL_ROUTES,
  PLANNING_CARDS,
  REQUEST_STAGES,
  ROUTE_LINE,
  ROUTE_START,
  ROUTE_STOPS,
  STANDING_CARDS,
  VOLUNTEER_POINTS,
} from './deliveries-content';
import { BrowserFrame } from '../ui/browser-frame';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { SIGNUP_URL } from '../ui/site-nav';

/**
 * "Yard signs & deliveries" — the page that explains the request pipeline, preview-then-commit
 * route planning, and the one-stop-at-a-time volunteer page. Structure mirrors /districts:
 * problem → proof with inline mocks → honest limits → CTA. All copy lives in
 * deliveries-content.ts.
 */
@Component({
  selector: 'pc-deliveries-page',
  imports: [SiteHeader, SiteFooter, SiteIcon, BrowserFrame, RouterLink],
  templateUrl: './deliveries-page.html',
})
export class DeliveriesPage {
  protected readonly signupUrl = SIGNUP_URL;

  protected readonly stages = REQUEST_STAGES;
  protected readonly routeLine = ROUTE_LINE;
  protected readonly routeStart = ROUTE_START;
  protected readonly routeStops = ROUTE_STOPS;
  protected readonly panelRoutes = PANEL_ROUTES;
  protected readonly planningCards = PLANNING_CARDS;
  protected readonly volunteerPoints = VOLUNTEER_POINTS;
  protected readonly standingCards = STANDING_CARDS;
  protected readonly limits = LIMITS;
  protected readonly driver = DRIVER_MOCK;
}
