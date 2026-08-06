import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { form, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import {
  BOUNDARY_MAX_FEATURES_PER_SET,
  BOUNDARY_MAX_SETS_PER_TENANT,
  BOUNDARY_MAX_VERTICES_PER_FEATURE,
  BOUNDARY_ROLES,
  BOUNDARY_ROLE_LABELS,
  BOUNDARY_SOURCES,
  BOUNDARY_SOURCE_LABELS,
  BOUNDARY_UPLOAD_MAX_LABEL,
  CHAMBERS,
  CHAMBER_LABELS,
  JURISDICTIONS,
  JURISDICTION_IDS,
  PUBLISHED_BOUNDARY_ENTRIES,
  formatPublishedBoundarySize,
  isJurisdictionId,
  publishedBoundariesForOffices,
  regionsForCountry,
  seatLabelPluralFor,
  subdivisionLabelPluralFor,
} from '@common';
import type {
  BoundaryFeatureRowType,
  BoundaryGeometryType,
  BoundaryRole,
  BoundarySetRowType,
  BoundarySource,
  BoundaryValidationType,
  JurisdictionId,
  PublishedBoundaryEntry,
  PublishedBoundaryMatch,
  Region,
} from '@common';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Card } from '@uxcommon/components/card/card';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { Input } from '@uxcommon/components/input/input';
import { PC_MAP_DEFAULT_ZOOM, PcMap } from '@uxcommon/components/map/map';
import type { PcLatLng, PcMapMarker, PcMapPolygon, PcMapPolygonEdit } from '@uxcommon/components/map/map-types';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { Select } from '@uxcommon/components/select/select';
import { Table } from '@uxcommon/components/table/table';
import { Textarea } from '@uxcommon/components/textarea/textarea';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthService } from '../../../auth/auth-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { getUserErrorMessage } from '../../../services/api/user-message';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import {
  type BoundaryPropertyOption,
  type GeoJsonInspection,
  checkBoundaryFileSize,
  countRawGeometryVertices,
  geometryOuterRings,
  geometryTooLargeToSave,
  guessCodeProperty,
  guessNameProperty,
  inspectBoundaryGeoJson,
  isTooDetailedToReshape,
  partPolygonId,
  readPartPolygonId,
  replaceOuterRing,
  ringToPolygonGeometry,
} from './boundary-geojson';
import { BoundariesService, type BoundaryHouseholdPin } from './services/boundaries-service';

/** Most household pins drawn at once. Past this the map is a solid block of dots and nothing reads. */
const MAX_PINS_DRAWN = 2_000;

/**
 * How long a reshaped area sits still before it is saved.
 *
 * Dragging a vertex reports the new shape more than once, and saving redraws the map. Redrawing
 * mid-drag would rebuild the shape under the user's own cursor, so the save waits for the hand to
 * stop. It is not a spinner delay: the panel says "Saving shape" for the whole window.
 */
const SHAPE_SAVE_IDLE_MS = 600;

/**
 * Where the map opens when the workspace has nothing on it to frame: no household pins, no areas,
 * no traced shape. The map component's own fallback is latitude 0, longitude 0 (open ocean off
 * West Africa) with wheel zoom off, which strands a first-time drawer. The set's jurisdiction
 * names the country, so the map opens country-wide instead: any city is then a few zooms away.
 */
const EMPTY_MAP_VIEW_CANADA = { center: { lat: 56.1, lng: -106.3 }, zoom: 4 } as const;
const EMPTY_MAP_VIEW_UNITED_STATES = { center: { lat: 39.8, lng: -98.6 }, zoom: 4 } as const;
const EMPTY_MAP_VIEW_WORLD = { center: { lat: 30, lng: 0 }, zoom: 2 } as const;

/** What the page is showing. These are modes rather than routes; "All maps" is the way back. */
type BoundariesMode = 'list' | 'draw-new' | 'upload' | 'map' | 'catalog';

/**
 * One published map as the picker lists it: the catalog entry plus what this workspace knows about
 * it. `added` is why the entry stays visible instead of disappearing — a map already in the
 * workspace should read as done, not as missing.
 */
interface CatalogRow {
  entry: PublishedBoundaryEntry;
  /** True when this workspace already holds this map. */
  added: boolean;
  /** True when a campaign in this workspace contests an office this map covers. */
  suggested: boolean;
  /** Download size, written the way a person reads it. */
  size: string;
}

/** The set form, shared by "draw a new map" and "upload a map". Values are strings from selects. */
interface SetFormValue {
  label: string;
  jurisdiction: string;
  role: string;
  region: string;
  chamber: string;
  vintage: string;
  description: string;
}

/** The catalog picker's search box. A form because `pc-input` binds a signal-form field. */
interface CatalogSearchValue {
  search: string;
}

/** The upload form's own two questions: which property holds the name, and which holds the code. */
interface UploadFormValue {
  nameProperty: string;
  codeProperty: string;
}

/** Naming one area, used both for a shape just drawn and for renaming a saved one. */
interface AreaFormValue {
  name: string;
  code: string;
}

function emptySetForm(): SetFormValue {
  return { label: '', jurisdiction: 'other', role: 'seat_area', region: '', chamber: '', vintage: '', description: '' };
}

/** Narrow a stored `boundary_sets.source` string, which arrives from the wire as plain text. */
function isBoundarySource(value: string): value is BoundarySource {
  return (BOUNDARY_SOURCES as readonly string[]).includes(value);
}

/** The same for a role chosen in a `<select>`, whose DOM value is always a string. */
function isBoundaryRole(value: string): value is BoundaryRole {
  return (BOUNDARY_ROLES as readonly string[]).includes(value);
}

/** True for a key event born in a form control or button, whose keys must keep their own meanings. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A';
}

/**
 * Workspace settings → Boundaries.
 *
 * A boundary map says which electoral areas cover which households. Nothing here ships with the
 * product: a workspace gets a map by importing the names it already has, uploading a published
 * GeoJSON file, or drawing the areas over its own household pins. Those three ways are the whole
 * of it, and the empty state teaches them rather than reporting that something is missing.
 *
 * THE COST RULE, said here because the page says it to the user too: nothing on this page calls a
 * paid service. Drawing, uploading, reshaping and re-matching re-read coordinates already stored on
 * the household and run a point-in-polygon test on the server. The paid step is geocoding, which
 * turns an address into coordinates, and it happens elsewhere. Users assume the opposite, so the
 * page states it plainly rather than leaving them to guess.
 */
@Component({
  selector: 'pc-boundaries-settings',
  imports: [Card, EmptyState, Icon, Input, PcMap, RouterLink, RowActions, Select, Table, Textarea],
  templateUrl: './boundaries-settings.html',
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class BoundariesSettingsComponent implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly boundaries = inject(BoundariesService);
  private readonly campaignContext = inject(CampaignContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly loaded = signal(false);

  private readonly map = viewChild(PcMap);

  // ── Shared reference data the template reads ──────────────────────────────────────────────────

  protected readonly jurisdictionOptions = JURISDICTION_IDS.map((id) => ({
    id,
    label: JURISDICTIONS[id].label,
    description: JURISDICTIONS[id].description,
  }));
  protected readonly roleOptions = BOUNDARY_ROLES.map((role) => ({ role, label: BOUNDARY_ROLE_LABELS[role] }));
  protected readonly chamberOptions = CHAMBERS.map((chamber) => ({ chamber, label: CHAMBER_LABELS[chamber] }));
  protected readonly maxSetsPerWorkspace = BOUNDARY_MAX_SETS_PER_TENANT;
  protected readonly maxAreasPerSet = BOUNDARY_MAX_FEATURES_PER_SET.toLocaleString();
  protected readonly maxPointsPerArea = BOUNDARY_MAX_VERTICES_PER_FEATURE.toLocaleString();
  protected readonly maxUploadLabel = BOUNDARY_UPLOAD_MAX_LABEL;

  /**
   * Deep-link for the two "import the names you already have" links.
   *
   * The import wizard reads `?type=` from the URL and falls back to People when it is absent, so a
   * bare `/imports/new` link from this page dropped the reader on a People import with no hint that
   * area names ride along in a HOUSEHOLDS import. Electoral columns are offered by the people
   * importer too, but a boundary belongs to a door, so this page names one path and names it
   * exactly. Held as a field rather than an inline object literal so the href is not recomputed on
   * every change-detection pass.
   */
  protected readonly importAreaNamesParams = { type: 'households' } as const;

  // ── Page state ────────────────────────────────────────────────────────────────────────────────

  protected readonly mode = signal<BoundariesMode>('list');
  protected readonly sets = signal<BoundarySetRowType[]>([]);
  protected readonly activeSetId = signal<string | null>(null);
  protected readonly features = signal<BoundaryFeatureRowType[]>([]);
  protected readonly featuresLoaded = signal(false);
  /** Areas in the open layer, including any the byte budget stopped the server sending. */
  protected readonly featuresTotal = signal(0);
  /** True when the map on screen is a prefix of the layer rather than all of it. */
  protected readonly featuresTruncated = signal(false);
  protected readonly validation = signal<BoundaryValidationType | null>(null);
  protected readonly validating = signal(false);
  /**
   * True when an area was added, reshaped or deleted since the numbers below were counted.
   *
   * The check walks every located household against every area of the layer in the API process, so
   * running it after each edit made an editing session pay for that scan over and over. It runs when
   * the map is opened and when the person presses "Check again"; in between, the page says the
   * numbers are out of date rather than silently showing figures for the previous shapes.
   */
  protected readonly validationStale = signal(false);
  protected readonly saving = signal(false);
  protected readonly rematching = signal(false);

  /** Household pins, fetched once and reused for every map. Capped server-side. */
  private readonly pins = signal<BoundaryHouseholdPin[]>([]);
  /** Every located household in the workspace, which is more than the pin list when it was capped. */
  private readonly locatedHouseholds = signal(0);
  protected readonly pinsLoaded = signal(false);

  /** Drawing mode: map clicks place vertices and saved areas grow draggable handles. */
  protected readonly drawing = signal(false);
  /** A shape traced but not yet named. It stays drawn on the map until it is saved or discarded. */
  protected readonly pendingPath = signal<PcLatLng[] | null>(null);
  protected readonly selectedFeatureId = signal<string | null>(null);
  /** Whether the map re-frames itself on the next redraw. Turned off by the first interaction. */
  protected readonly autoFit = signal(true);
  protected readonly savingShape = signal(false);

  /** Reshaped areas waiting for the hand to stop moving. Keyed by the map's own part id. */
  private readonly pendingShapes = new Map<string, PcLatLng[]>();
  private shapeSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── The upload draft ──────────────────────────────────────────────────────────────────────────

  protected readonly chosenFile = signal<File | null>(null);
  protected readonly inspection = signal<GeoJsonInspection | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly reading = signal(false);

  // ── Forms ─────────────────────────────────────────────────────────────────────────────────────

  protected readonly setPayload = signal<SetFormValue>(emptySetForm());

  /**
   * The jurisdiction chosen right now, so the form shows only the questions that apply to it. A
   * Canadian federal map never sees a chamber selector; an Ohio one never sees a province list.
   */
  protected readonly setSpec = computed(() => {
    const chosen = this.setPayload().jurisdiction;
    return JURISDICTIONS[isJurisdictionId(chosen) ? chosen : 'other'];
  });

  protected readonly setForm = form(this.setPayload, (p) => {
    required(p.label, { message: 'Give the map a name your organizers will recognize.' });
    // Only US state legislative maps have a chamber, and the two chambers are two different maps,
    // so leaving it blank there would produce a map nothing can match against.
    required(p.chamber, {
      message: 'A state legislative map covers one chamber. Say which.',
      when: () => this.setSpec().usesChamber,
    });
  });

  protected readonly uploadPayload = signal<UploadFormValue>({ nameProperty: '', codeProperty: '' });
  protected readonly uploadForm = form(this.uploadPayload, (p) => {
    required(p.nameProperty, { message: 'Choose which property in the file holds each area name.' });
  });

  protected readonly areaPayload = signal<AreaFormValue>({ name: '', code: '' });
  protected readonly areaForm = form(this.areaPayload, (p) => {
    required(p.name, { message: 'Every area needs a name.' });
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      // Leaving the page must not throw away a reshape still waiting out its idle timer: the user
      // saw "Saving shape" and made the change on screen. The save cannot be awaited during
      // destroy, so it is fired; a failure still surfaces through the app-level error toast.
      void this.flushShapeEdits();
    });
  }

  public ngOnInit(): void {
    void this.loadSets();
  }

  // ── Derived state ─────────────────────────────────────────────────────────────────────────────

  /** Mutations are admin-or-owner server-side; say so here rather than letting a click fail. */
  protected readonly canEdit = computed(() => {
    const role = this.auth.getUserSignal()()?.role;
    return role === 'admin' || role === 'owner';
  });

  protected readonly atSetLimit = computed(() => this.sets().length >= BOUNDARY_MAX_SETS_PER_TENANT);

  // ── The published catalog ─────────────────────────────────────────────────────────────────────
  //
  // The catalog is a constant compiled into the app, not a request: the backend validates an add
  // against the same array this filters, so the two cannot disagree about which maps exist. That is
  // why there is no loading state here and no spinner on opening the picker.

  protected readonly catalogSearchPayload = signal<CatalogSearchValue>({ search: '' });
  protected readonly catalogSearchForm = form(this.catalogSearchPayload, () => {
    // No validators: any text is a legitimate search, including text that matches nothing.
  });
  private readonly catalogSearch = computed(() => this.catalogSearchPayload().search);
  protected readonly catalogHasEntries = PUBLISHED_BOUNDARY_ENTRIES.length > 0;

  /** The offices this workspace's campaigns contest, which is what makes a map worth suggesting. */
  private readonly campaignOffices = computed<PublishedBoundaryMatch[]>(() =>
    this.campaignContext.campaigns().map((campaign) => ({
      jurisdiction: isJurisdictionId(campaign.jurisdiction) ? campaign.jurisdiction : 'other',
      region: campaign.office_region ?? null,
      chamber: campaign.chamber === 'upper' || campaign.chamber === 'lower' ? campaign.chamber : null,
    })),
  );

  /**
   * Maps already in this workspace, by catalog slug.
   *
   * A published set always carries the catalog slug verbatim, which is what lets the picker say
   * "already added" rather than offering a second copy the server would refuse anyway.
   */
  private readonly addedCatalogSlugs = computed(
    () =>
      new Set(
        this.sets()
          .filter((set) => set.source === 'bundled')
          .map((set) => set.slug),
      ),
  );

  private readonly suggestedCatalogSlugs = computed(
    () => new Set(publishedBoundariesForOffices(this.campaignOffices()).map((entry) => entry.slug)),
  );

  /** Every catalog entry, suggested ones first, filtered by the search box. */
  protected readonly catalogRows = computed<CatalogRow[]>(() => {
    const added = this.addedCatalogSlugs();
    const suggested = this.suggestedCatalogSlugs();
    const term = this.catalogSearch().trim().toLowerCase();

    const rows = PUBLISHED_BOUNDARY_ENTRIES.filter((entry) => {
      if (!term) return true;
      return [entry.label, entry.publisher, entry.vintage, entry.region ?? ''].join(' ').toLowerCase().includes(term);
    }).map<CatalogRow>((entry) => ({
      entry,
      added: added.has(entry.slug),
      suggested: suggested.has(entry.slug),
      size: formatPublishedBoundarySize(entry.bytes),
    }));

    // A stable two-group order: what this workspace's campaigns need, then everything else in
    // catalog order. Sorting inside a group would reorder the list as campaigns change, which makes
    // a list somebody is reading move under them.
    return [...rows.filter((row) => row.suggested), ...rows.filter((row) => !row.suggested)];
  });

  protected readonly suggestedCatalogCount = computed(() => this.catalogRows().filter((row) => row.suggested).length);

  protected readonly activeSet = computed<BoundarySetRowType | null>(() => {
    const id = this.activeSetId();
    return this.sets().find((set) => set.id === id) ?? null;
  });

  protected readonly selectedFeature = computed<BoundaryFeatureRowType | null>(() => {
    const id = this.selectedFeatureId();
    return this.features().find((feature) => feature.id === id) ?? null;
  });

  protected readonly setRegionOptions = computed<readonly Region[]>(() => regionsForCountry(this.setSpec().country));

  protected readonly propertyOptions = computed<readonly BoundaryPropertyOption[]>(
    () => this.inspection()?.properties ?? [],
  );

  /** The first three area names the chosen property produces, so a wrong choice is obvious. */
  protected readonly namePreview = computed<string[]>(() => {
    const key = this.uploadPayload().nameProperty;
    return this.propertyOptions().find((property) => property.key === key)?.samples ?? [];
  });

  protected readonly mapMarkers = computed<PcMapMarker[]>(() =>
    this.pins()
      .slice(0, MAX_PINS_DRAWN)
      .map((pin) => ({ position: { lat: pin.lat, lng: pin.lng }, variant: 'muted' as const, tooltip: pin.label })),
  );

  /**
   * How many pins are on the map, and how many located households the workspace holds.
   *
   * These are two different numbers and the caption has to say both. Pins are thinned twice: the
   * server returns at most a few thousand of them, and this page draws at most {@link MAX_PINS_DRAWN}
   * of those. The count of located households comes from the server as its own number, so it stays
   * true however much the pin layer was thinned.
   */
  protected readonly pinsShown = computed(() => Math.min(this.pins().length, MAX_PINS_DRAWN));
  protected readonly pinsTotal = computed(() => this.locatedHouseholds());
  protected readonly pinsCapped = computed(() => this.pinsShown() < this.pinsTotal());

  /**
   * Every area on the map, one shape per part.
   *
   * A part gets its own id because a feature can have several (an island ward, a ward split by a
   * river) and each is drawn separately. The shape being traced right now is included so it stays
   * visible while it is being named.
   */
  protected readonly mapPolygons = computed<PcMapPolygon[]>(() => {
    const selected = this.selectedFeatureId();
    const polygons: PcMapPolygon[] = [];
    for (const feature of this.features()) {
      // A feature past the reshape threshold renders view-only in edit mode: thousands of handles
      // freeze the tab, and a saved reshape would exceed the server's request-body limit anyway.
      // The side panel says so on the feature itself; see MAX_RESHAPE_VERTICES for the arithmetic.
      const editable = !isTooDetailedToReshape(feature.geometry);
      geometryOuterRings(feature.geometry).forEach((path, partIndex) => {
        polygons.push({
          path,
          id: partPolygonId(feature.id, partIndex),
          label: feature.name,
          variant: feature.id === selected ? 'primary' : 'neutral',
          editable,
        });
      });
    }
    const pending = this.pendingPath();
    // Deliberately id-less: the map grows edit handles only on identified polygons (edits are
    // reported by id), so the not-yet-saved shape renders with no handles rather than with handles
    // whose changes would be silently thrown away on save. Fixing its corners means discarding it
    // and retracing, which the panel's Discard button offers.
    if (pending) polygons.push({ path: pending, variant: 'success', label: 'Not saved yet' });
    return polygons;
  });

  /**
   * The explicit view for a map with nothing on it to frame. Null as soon as any content exists
   * (pins, saved areas, or a traced shape), which hands framing back to the map's fit-to-content
   * behaviour; the map reads `center` only while it is non-null.
   */
  private readonly emptyMapView = computed(() => {
    if (this.pins().length > 0 || this.features().length > 0 || this.pendingPath()) return null;
    const jurisdiction = this.activeSet()?.jurisdiction ?? '';
    if (jurisdiction.startsWith('ca_')) return EMPTY_MAP_VIEW_CANADA;
    if (jurisdiction.startsWith('us_')) return EMPTY_MAP_VIEW_UNITED_STATES;
    return EMPTY_MAP_VIEW_WORLD;
  });

  protected readonly emptyMapCenter = computed<PcLatLng | null>(() => this.emptyMapView()?.center ?? null);
  protected readonly emptyMapZoom = computed<number>(() => this.emptyMapView()?.zoom ?? PC_MAP_DEFAULT_ZOOM);

  /** The part id the map should highlight. Only the first part of a multi-part area is marked. */
  protected readonly selectedPolygonId = computed<string | null>(() => {
    const id = this.selectedFeatureId();
    return id === null ? null : partPolygonId(id, 0);
  });

  protected readonly draftVertexCount = computed(() => this.map()?.draftVertexCount() ?? 0);
  protected readonly canFinishShape = computed(() => this.map()?.canFinishDrawing() ?? false);

  /** How many households this map places nowhere, in the workspace's own words. */
  protected readonly validationSummary = computed<string | null>(() => {
    const result = this.validation();
    if (!result) return null;
    if (result.examined === 0) {
      return 'No household has coordinates yet, so there is nothing to check this map against.';
    }
    const parts = [
      `${result.unmatched.toLocaleString()} of ${result.examined.toLocaleString()} located households fall in no area`,
      `${result.multiply_matched.toLocaleString()} fall in more than one`,
    ];
    return `${parts.join(', and ')}.`;
  });

  // ── Labels ────────────────────────────────────────────────────────────────────────────────────

  /** What one map covers, in the word that jurisdiction actually uses: Wards, Ridings, Precincts. */
  protected coversLabel(set: BoundarySetRowType): string {
    const jurisdiction = isJurisdictionId(set.jurisdiction) ? set.jurisdiction : 'other';
    if (set.role === 'seat_area') return seatLabelPluralFor(jurisdiction, set.region, null);
    if (set.role === 'subdivision') return subdivisionLabelPluralFor(jurisdiction, set.region);
    return 'Localities';
  }

  /** The second line under the covers label: the level of government, the region, the chamber. */
  protected scopeLabel(set: BoundarySetRowType): string {
    const jurisdiction = isJurisdictionId(set.jurisdiction) ? set.jurisdiction : 'other';
    const spec = JURISDICTIONS[jurisdiction];
    const parts = [spec.label];
    const region = set.region
      ? (regionsForCountry(spec.country).find((entry) => entry.code === set.region)?.name ?? set.region)
      : null;
    if (region) parts.push(region);
    if (set.chamber === 'upper' || set.chamber === 'lower') parts.push(CHAMBER_LABELS[set.chamber]);
    return parts.join(' · ');
  }

  protected sourceLabel(set: BoundarySetRowType): string {
    return isBoundarySource(set.source) ? BOUNDARY_SOURCE_LABELS[set.source] : set.source;
  }

  /**
   * True when an area is drawn in more than one piece (an island ward, a ward split by a river).
   * Each piece is drawn as its own shape on the map, and each piece can be reshaped on its own;
   * the flag only changes the wording of the side panel's editing hint.
   */
  protected isMultiPart(feature: BoundaryFeatureRowType): boolean {
    return geometryOuterRings(feature.geometry).length > 1;
  }

  /** True when this area holds too many points to reshape on the map. See MAX_RESHAPE_VERTICES. */
  protected tooDetailedToReshape(feature: BoundaryFeatureRowType): boolean {
    return isTooDetailedToReshape(feature.geometry);
  }

  /** How many points an area holds, for the too-detailed-to-reshape note. */
  protected featurePointCount(feature: BoundaryFeatureRowType): number {
    return countRawGeometryVertices(feature.geometry) ?? 0;
  }

  // ── Loading ───────────────────────────────────────────────────────────────────────────────────

  private async loadSets(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.sets.set(await this.boundaries.listSets());
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load your boundary maps.'));
    } finally {
      this.loaded.set(true);
      end();
    }
  }

  private async loadFeatures(setId: string): Promise<void> {
    const end = this._loading.begin();
    try {
      const result = await this.boundaries.listFeatures(setId);
      this.features.set(result.features);
      this.featuresTotal.set(result.total);
      this.featuresTruncated.set(result.truncated);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load the areas in this map.'));
    } finally {
      this.featuresLoaded.set(true);
      end();
    }
  }

  private async loadPins(): Promise<void> {
    if (this.pinsLoaded()) return;
    try {
      const loaded = await this.boundaries.listHouseholdPins();
      this.pins.set(loaded.pins);
      this.locatedHouseholds.set(loaded.totalLocated);
    } catch (err) {
      // A missing pin layer does not stop anyone drawing, so this reports and carries on.
      this.alerts.showError(getUserErrorMessage(err, 'Could not load household pins for the map.'));
    } finally {
      this.pinsLoaded.set(true);
    }
  }

  private async refreshValidation(setId: string): Promise<void> {
    this.validating.set(true);
    try {
      this.validation.set(await this.boundaries.validate(setId));
      this.validationStale.set(false);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not check this map against your households.'));
    } finally {
      this.validating.set(false);
    }
  }

  protected async recheck(): Promise<void> {
    const setId = this.activeSetId();
    if (setId) await this.refreshValidation(setId);
  }

  // ── Navigation between modes ──────────────────────────────────────────────────────────────────

  protected async showList(): Promise<void> {
    if (!(await this.confirmDiscardPendingShape())) return;
    // A reshape still waiting out its idle timer must be saved before the state it needs
    // (the feature list, the active set id) is cleared, or the visible edit would vanish silently.
    await this.flushShapeEdits();
    this.mode.set('list');
    this.activeSetId.set(null);
    this.features.set([]);
    this.featuresLoaded.set(false);
    this.featuresTotal.set(0);
    this.featuresTruncated.set(false);
    this.validation.set(null);
    this.validationStale.set(false);
    this.drawing.set(false);
    this.pendingPath.set(null);
    this.selectedFeatureId.set(null);
    this.autoFit.set(true);
  }

  protected startDrawNew(): void {
    this.setPayload.set(emptySetForm());
    this.setForm().reset();
    this.mode.set('draw-new');
  }

  /**
   * Open the published-map picker.
   *
   * The campaign list is loaded on the way in rather than on page load, because it is only used to
   * decide which maps to put first and most visits to this page never open the picker at all.
   * `ensureLoaded` is a no-op when something else already loaded it.
   */
  protected async startCatalog(): Promise<void> {
    this.catalogSearchPayload.set({ search: '' });
    this.catalogSearchForm().reset();
    this.mode.set('catalog');
    try {
      await this.campaignContext.ensureLoaded();
    } catch {
      // Suggestions are an ordering nicety. Losing them leaves the full catalog listed and usable,
      // so this stays silent rather than putting an error toast in front of a working picker.
    }
  }

  /**
   * Add a published map, after saying plainly what is about to happen.
   *
   * The confirm step is not ceremony: adding a map re-matches every located household in the
   * workspace, which changes the area shown on every household card and the lines canvassing turfs
   * are cut along. It costs nothing and calls no paid service, and the dialog says both.
   */
  protected async addPublishedMap(row: CatalogRow): Promise<void> {
    if (row.added || this.atSetLimit() || this.saving()) return;

    const confirmed = await this.dialogs.confirm({
      title: `Add ${row.entry.label}?`,
      message:
        `${row.entry.publisher} — ${row.entry.vintage}. ${row.entry.featureCount.toLocaleString()} areas. ` +
        'Every household that already has coordinates will be matched into one of them. This is free and calls no paid service.',
      confirmText: 'Add map',
    });
    if (!confirmed) return;

    this.saving.set(true);
    const end = this._loading.begin();
    try {
      await this.boundaries.addPublishedSet(row.entry.slug);
      this.alerts.showSuccess(`${row.entry.label} added. Your households are being matched now.`);
      await this.loadSets();
      this.mode.set('list');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not add that map.'));
    } finally {
      this.saving.set(false);
      end();
    }
  }

  protected startUpload(): void {
    this.setPayload.set(emptySetForm());
    this.setForm().reset();
    this.uploadPayload.set({ nameProperty: '', codeProperty: '' });
    this.uploadForm().reset();
    this.chosenFile.set(null);
    this.inspection.set(null);
    this.fileError.set(null);
    this.mode.set('upload');
  }

  protected async openMap(set: BoundarySetRowType): Promise<void> {
    this.activeSetId.set(set.id);
    this.features.set([]);
    this.featuresLoaded.set(false);
    this.validation.set(null);
    this.validationStale.set(false);
    this.selectedFeatureId.set(null);
    this.pendingPath.set(null);
    this.drawing.set(false);
    this.autoFit.set(true);
    this.mode.set('map');
    await Promise.all([this.loadFeatures(set.id), this.loadPins()]);
    await this.refreshValidation(set.id);
  }

  // ── Creating a map ────────────────────────────────────────────────────────────────────────────

  /** The fields both create paths share, with values that do not apply to this jurisdiction dropped. */
  private setInputFromForm(): {
    label: string;
    jurisdiction: JurisdictionId;
    role: BoundaryRole;
    region: string | null;
    chamber: 'upper' | 'lower' | null;
    vintage: string | null;
  } {
    const value = this.setPayload();
    const spec = this.setSpec();
    const chamber = value.chamber === 'upper' || value.chamber === 'lower' ? value.chamber : null;
    return {
      label: value.label.trim(),
      jurisdiction: spec.id,
      role: isBoundaryRole(value.role) ? value.role : 'seat_area',
      region: spec.country && value.region ? value.region : null,
      chamber: spec.usesChamber ? chamber : null,
      vintage: value.vintage.trim() || null,
    };
  }

  protected async createDrawnSet(): Promise<void> {
    this.setForm().markAsTouched();
    if (this.setForm().invalid() || this.saving()) return;

    this.saving.set(true);
    try {
      const created = await this.boundaries.createDrawnSet({
        ...this.setInputFromForm(),
        description: this.setPayload().description.trim() || null,
      });
      this.sets.update((sets) => [created, ...sets]);
      this.alerts.showSuccess(`${created.label} is ready. Draw its first area on the map.`);
      await this.openMap(created);
      this.drawing.set(true);
      this.autoFit.set(false);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not create the map.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Uploading a map ───────────────────────────────────────────────────────────────────────────

  protected async chooseFile(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.chosenFile.set(null);
    this.inspection.set(null);
    this.fileError.set(null);

    const sizeProblem = checkBoundaryFileSize(file.size);
    if (sizeProblem) {
      this.fileError.set(sizeProblem);
      return;
    }

    this.reading.set(true);
    try {
      const result = inspectBoundaryGeoJson(await file.text());
      if (!result.ok) {
        this.fileError.set(result.message);
        return;
      }
      const nameProperty = guessNameProperty(result.inspection.properties);
      this.chosenFile.set(file);
      this.inspection.set(result.inspection);
      this.uploadPayload.set({
        nameProperty,
        codeProperty: guessCodeProperty(result.inspection.properties, nameProperty),
      });
      this.uploadForm().reset();
      if (!this.setPayload().label.trim()) {
        this.setPayload.update((value) => ({ ...value, label: file.name.replace(/\.(geo)?json$/i, '') }));
      }
    } catch {
      this.fileError.set('That file could not be read. Check it downloaded completely, then try again.');
    } finally {
      this.reading.set(false);
    }
  }

  protected async uploadSet(): Promise<void> {
    this.setForm().markAsTouched();
    this.uploadForm().markAsTouched();
    const file = this.chosenFile();
    if (!file || this.setForm().invalid() || this.uploadForm().invalid() || this.saving()) return;

    this.saving.set(true);
    try {
      const fileId = await this.boundaries.uploadOriginalFile(file);
      const created = await this.boundaries.uploadSet({
        ...this.setInputFromForm(),
        file_id: fileId,
        name_property: this.uploadPayload().nameProperty,
        code_property: this.uploadPayload().codeProperty || null,
      });
      this.sets.update((sets) => [created, ...sets]);
      this.alerts.showSuccess(
        `${created.label} added with ${created.feature_count.toLocaleString()} areas. Matching your households against it has been queued.`,
      );
      await this.openMap(created);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not add that map.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Deleting and re-matching ──────────────────────────────────────────────────────────────────

  protected async deleteSet(set: BoundarySetRowType): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Delete ${set.label}?`,
      message: `This removes the map, its ${set.feature_count.toLocaleString()} areas, and every household's membership in it. Your other maps and the areas they assign are untouched. This cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete map',
    });
    if (!confirmed) return;

    try {
      await this.boundaries.deleteSet(set.id);
      this.sets.update((sets) => sets.filter((existing) => existing.id !== set.id));
      if (this.activeSetId() === set.id) {
        // The whole map is gone, so reshapes buffered for it and any half-made shape go with it;
        // flushing them would post updates for features that no longer exist.
        this.dropBufferedShapeEdits();
        this.pendingPath.set(null);
        await this.showList();
      }
      this.alerts.showSuccess(`${set.label} deleted.`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not delete that map.'));
    }
  }

  /** Throw away buffered reshapes without saving them. Only for a map that no longer exists. */
  private dropBufferedShapeEdits(): void {
    if (this.shapeSaveTimer) {
      clearTimeout(this.shapeSaveTimer);
      this.shapeSaveTimer = null;
    }
    this.pendingShapes.clear();
    this.savingShape.set(false);
  }

  protected async rematch(setId: string | null): Promise<void> {
    if (this.rematching()) return;
    this.rematching.set(true);
    try {
      await this.boundaries.rematch(setId);
      this.alerts.showSuccess('Re-matching queued. It reads coordinates already on file, so it costs nothing.');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not queue the re-match.'));
    } finally {
      this.rematching.set(false);
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────────

  /**
   * The discard rule, stated once: a FINISHED unsaved shape (traced, closed, waiting for a name)
   * is guarded by a confirm wherever it would be lost, which is here ("Done editing") and in
   * `showList` ("All maps"). A shape still in progress is a few clicks to retrace, so it is
   * discarded without ceremony — by Escape, and by these same actions.
   */
  protected async toggleDrawing(): Promise<void> {
    const next = !this.drawing();
    if (!next && !(await this.confirmDiscardPendingShape())) return;
    // Any deliberate interaction stops the map re-framing itself, so a careful zoom survives a save.
    this.autoFit.set(false);
    this.drawing.set(next);
    if (!next) {
      // Leaving edit mode redraws saved shapes from stored geometry, so a reshape still waiting
      // out its idle timer is saved now rather than visually reverting and saving later.
      void this.flushShapeEdits();
      this.pendingPath.set(null);
      this.map()?.cancelDrawing();
    }
  }

  /** Ask before an action that would discard a finished, unsaved shape. True means go ahead. */
  private async confirmDiscardPendingShape(): Promise<boolean> {
    if (!this.pendingPath()) return true;
    return this.dialogs.confirm({
      title: 'Discard the unsaved shape?',
      message: 'Your unsaved shape will be discarded. It has no name yet, so it is not part of this map.',
      variant: 'danger',
      confirmText: 'Discard shape',
      cancelText: 'Keep it',
      emphasizeCancel: true,
    });
  }

  /**
   * Keyboard support while tracing: Escape throws away the shape in progress (quick to retrace,
   * so no confirm; the confirm above guards only a finished unsaved shape), Enter closes it once
   * it has three corners. Both map methods report whether they acted, so the key is consumed
   * exactly when it did something. Keys born in form controls and buttons are left alone.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (this.mode() !== 'map' || !this.drawing()) return;
    if (isInteractiveTarget(event.target)) return;
    const map = this.map();
    if (!map) return;
    if (event.key === 'Escape') {
      if (map.cancelDrawing()) event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      if (map.finishDrawing()) event.preventDefault();
    }
  }

  protected finishShape(): void {
    this.map()?.finishDrawing();
  }

  protected undoVertex(): void {
    this.map()?.undoLastVertex();
  }

  protected cancelShape(): void {
    this.map()?.cancelDrawing();
    this.pendingPath.set(null);
  }

  protected onPolygonDrawn(path: PcLatLng[]): void {
    this.autoFit.set(false);
    this.selectedFeatureId.set(null);
    this.pendingPath.set(path);
    this.areaPayload.set({ name: '', code: '' });
    this.areaForm().reset();
  }

  protected discardPendingShape(): void {
    this.pendingPath.set(null);
  }

  protected async savePendingShape(): Promise<void> {
    this.areaForm().markAsTouched();
    const path = this.pendingPath();
    const setId = this.activeSetId();
    if (!path || !setId || this.areaForm().invalid() || this.saving()) return;

    const geometry = ringToPolygonGeometry(path);
    if (!geometry) {
      this.alerts.showError('That shape has fewer than three corners, so it does not enclose an area.');
      return;
    }

    this.saving.set(true);
    try {
      const created = await this.boundaries.addFeature({
        set_id: setId,
        name: this.areaPayload().name.trim(),
        code: this.areaPayload().code.trim() || null,
        geometry,
      });
      this.pendingPath.set(null);
      this.features.update((features) => [...features, created]);
      this.bumpSetFeatureCount(setId, 1);
      this.alerts.showSuccess(`${created.name} saved.`);
      // The fit numbers now describe the map as it was before this area existed. Re-counting them
      // scans every located household against every area, so it waits to be asked; see
      // `validationStale`.
      this.validationStale.set(true);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not save that area.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Selecting, renaming and reshaping a saved area ────────────────────────────────────────────

  protected async selectFeature(featureId: string): Promise<void> {
    // Selecting redraws the map, which would throw away a reshape still waiting to be saved. Saving
    // it first is what makes the click do exactly what it looks like it does.
    await this.flushShapeEdits();
    this.autoFit.set(false);
    this.selectedFeatureId.set(featureId);
    const feature = this.features().find((existing) => existing.id === featureId);
    this.areaPayload.set({ name: feature?.name ?? '', code: feature?.code ?? '' });
    this.areaForm().reset();
  }

  protected onPolygonSelected(partId: string): void {
    const parsed = readPartPolygonId(partId);
    if (!parsed) return;
    void this.selectFeature(parsed.featureId);
  }

  protected clearSelection(): void {
    this.selectedFeatureId.set(null);
  }

  protected async renameSelected(): Promise<void> {
    this.areaForm().markAsTouched();
    const feature = this.selectedFeature();
    const setId = this.activeSetId();
    if (!feature || !setId || this.areaForm().invalid() || this.saving()) return;

    const name = this.areaPayload().name.trim();
    const code = this.areaPayload().code.trim() || null;
    if (name === feature.name && code === feature.code) return;

    this.saving.set(true);
    try {
      const updated = await this.boundaries.updateFeature(feature.id, { name, code });
      this.replaceFeature(updated);
      this.alerts.showSuccess(`Renamed to ${updated.name}.`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not rename that area.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteSelected(): Promise<void> {
    const feature = this.selectedFeature();
    const setId = this.activeSetId();
    if (!feature || !setId) return;

    const confirmed = await this.dialogs.confirm({
      title: `Delete ${feature.name}?`,
      message:
        'The area and every household placed in it are removed from this map. Households themselves are untouched. This cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete area',
    });
    if (!confirmed) return;

    try {
      await this.boundaries.deleteFeature(feature.id);
      this.features.update((features) => features.filter((existing) => existing.id !== feature.id));
      this.selectedFeatureId.set(null);
      this.bumpSetFeatureCount(setId, -1);
      this.alerts.showSuccess(`${feature.name} deleted.`);
      this.validationStale.set(true);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not delete that area.'));
    }
  }

  protected onPolygonDeleted(partId: string): void {
    const parsed = readPartPolygonId(partId);
    if (!parsed) return;
    void this.selectFeature(parsed.featureId).then(() => this.deleteSelected());
  }

  /**
   * A vertex moved. Remember the new ring and start the idle timer; see {@link SHAPE_SAVE_IDLE_MS}
   * for why the save waits rather than firing on every reported change.
   */
  protected onPolygonEdited(edit: PcMapPolygonEdit): void {
    if (!readPartPolygonId(edit.id)) return;
    this.pendingShapes.set(edit.id, edit.path);
    this.savingShape.set(true);
    if (this.shapeSaveTimer) clearTimeout(this.shapeSaveTimer);
    this.shapeSaveTimer = setTimeout(() => void this.flushShapeEdits(), SHAPE_SAVE_IDLE_MS);
  }

  private async flushShapeEdits(): Promise<void> {
    if (this.shapeSaveTimer) {
      clearTimeout(this.shapeSaveTimer);
      this.shapeSaveTimer = null;
    }
    if (this.pendingShapes.size === 0) {
      this.savingShape.set(false);
      return;
    }

    const edits = [...this.pendingShapes.entries()];
    this.pendingShapes.clear();
    const setId = this.activeSetId();
    // True when a change shown on the map was refused, so the screen no longer matches the server.
    let diverged = false;

    try {
      for (const [partId, path] of edits) {
        const parsed = readPartPolygonId(partId);
        if (!parsed) continue;
        const feature = this.features().find((existing) => existing.id === parsed.featureId);
        if (!feature) continue;
        const geometry: BoundaryGeometryType | null = replaceOuterRing(feature.geometry, parsed.partIndex, path);
        if (!geometry) {
          this.alerts.showError(`${feature.name} needs at least three corners, so that change was not saved.`);
          diverged = true;
          continue;
        }
        if (geometryTooLargeToSave(geometry)) {
          // The server refuses request bodies over 1 MiB; refusing here turns what would come back
          // as a bare HTTP 413 (with the edit lost anyway) into a sentence naming the way forward.
          const points = (countRawGeometryVertices(geometry) ?? 0).toLocaleString();
          this.alerts.showError(
            `${feature.name} has ${points} points, too detailed to reshape here. Replace it by uploading a corrected file.`,
          );
          diverged = true;
          continue;
        }
        this.replaceFeature(await this.boundaries.updateFeature(feature.id, { geometry }));
        // The saved shape moves households between areas, so the fit numbers on screen are now for
        // the old shape. They are re-counted on request rather than after every drag: the count
        // walks every located household against every area. See `validationStale`.
        this.validationStale.set(true);
      }
      // A refused change would otherwise stay drawn, showing a shape the server never accepted.
      if (diverged && setId) await this.loadFeatures(setId);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not save the new shape.'));
      // The screen and the server have diverged, so re-read rather than leave a shape that is a lie.
      if (setId) await this.loadFeatures(setId);
    } finally {
      this.savingShape.set(false);
    }
  }

  protected fitMap(): void {
    this.autoFit.set(true);
  }

  // ── Small mutations of local state ────────────────────────────────────────────────────────────

  private replaceFeature(updated: BoundaryFeatureRowType): void {
    this.features.update((features) => features.map((existing) => (existing.id === updated.id ? updated : existing)));
  }

  private bumpSetFeatureCount(setId: string, delta: number): void {
    this.sets.update((sets) =>
      sets.map((set) => (set.id === setId ? { ...set, feature_count: Math.max(0, set.feature_count + delta) } : set)),
    );
  }
}
