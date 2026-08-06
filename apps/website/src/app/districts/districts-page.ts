import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  AT_LARGE_EXAMPLES,
  DEFAULT_VOCABULARY_SAMPLE,
  DRAWN_AREAS,
  IMPORT_MAPPINGS,
  JURISDICTION_ROWS,
  LIMITS,
  MAP_PINS,
  MAP_SOURCES,
  VOCABULARY_SAMPLES,
  type VocabularySample,
} from './districts-content';
import { ADDRESSES, RESIDENTS } from '../home/audience-content';
import { BrowserFrame } from '../ui/browser-frame';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { SIGNUP_URL } from '../ui/site-nav';

/** One row of the households-grid mock: the shared cast, plus this sample's geography. */
interface GridRow {
  readonly addr: string;
  readonly who: string;
  readonly seat: string;
  readonly subdivision: string;
}

/**
 * "Ridings, wards and districts" — the page that explains how one product covers a Canadian
 * federal riding, an Alberta constituency, a Toronto ward, an Ohio congressional district, an
 * Arizona legislative district and a statewide US Senate race.
 *
 * The section that has to land is the vocabulary demonstration: the visitor picks an office and
 * watches the same screen relabel itself. It is a plain signal driving a template, no library
 * and no animation, because the argument is the relabelling, not the transition.
 */
@Component({
  selector: 'pc-districts-page',
  imports: [SiteHeader, SiteFooter, SiteIcon, BrowserFrame, RouterLink],
  templateUrl: './districts-page.html',
})
export class DistrictsPage {
  protected readonly signupUrl = SIGNUP_URL;

  protected readonly jurisdictions = JURISDICTION_ROWS;
  protected readonly atLarge = AT_LARGE_EXAMPLES;
  protected readonly samples = VOCABULARY_SAMPLES;
  protected readonly importMappings = IMPORT_MAPPINGS;
  protected readonly drawnAreas = DRAWN_AREAS;
  protected readonly mapPins = MAP_PINS;
  /** Select, import, upload, draw. There is no fifth way. Only the published maps are included. */
  protected readonly mapSources = MAP_SOURCES;
  protected readonly limits = LIMITS;

  /** The office the visitor is currently looking at. Holds the object, never an index. */
  protected readonly sample = signal<VocabularySample>(DEFAULT_VOCABULARY_SAMPLE);

  /**
   * The grid mock's rows: the five household names the whole site shares, wearing this
   * sample's geography. `?? ''` rather than `!` because the cast is a fixed-length tuple and
   * `noUncheckedIndexedAccess` is on; a sample longer than the cast would render blank names
   * rather than crash.
   */
  protected readonly gridRows = computed<readonly GridRow[]>(() =>
    this.sample().rows.map((row, index) => ({
      addr: ADDRESSES[index] ?? '',
      who: RESIDENTS[index] ?? '',
      seat: row.seat,
      subdivision: row.subdivision,
    })),
  );

  protected pick(next: VocabularySample): void {
    this.sample.set(next);
  }
}
