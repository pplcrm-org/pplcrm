import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  BOUNDARY_LINE,
  CANVASS_FIELD,
  COMPANION_POINTS,
  CUTTING_CARDS,
  DOOR_PRESETS,
  LIMITS,
  TRUST_CARDS,
  TURF_A,
  TURF_B,
  TURF_STATUSES,
  WALK_SHEET_ROWS,
} from './canvassing-content';
import { BrowserFrame } from '../ui/browser-frame';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { SIGNUP_URL } from '../ui/site-nav';

/**
 * "Canvassing & turfs" — the page that explains turf cutting that respects electoral
 * boundaries, the live turf page, the printable walk sheet, and the account-less
 * canvass companion. Structure mirrors /districts: problem → proof with inline mocks →
 * honest limits → CTA. All copy lives in canvassing-content.ts.
 */
@Component({
  selector: 'pc-canvassing-page',
  imports: [SiteHeader, SiteFooter, SiteIcon, BrowserFrame, RouterLink],
  templateUrl: './canvassing-page.html',
})
export class CanvassingPage {
  protected readonly signupUrl = SIGNUP_URL;

  protected readonly presets = DOOR_PRESETS;
  protected readonly statuses = TURF_STATUSES;
  protected readonly boundaryLine = BOUNDARY_LINE;
  protected readonly turfA = TURF_A;
  protected readonly turfB = TURF_B;
  protected readonly cuttingCards = CUTTING_CARDS;
  protected readonly sheetRows = WALK_SHEET_ROWS;
  protected readonly companionPoints = COMPANION_POINTS;
  protected readonly trustCards = TRUST_CARDS;
  protected readonly limits = LIMITS;
  protected readonly field = CANVASS_FIELD;
}
