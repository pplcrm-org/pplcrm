import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { BreadcrumbsService } from '@uxcommon/components/breadcrumbs/breadcrumbs.service';
import { Qr } from '@uxcommon/components/qr/qr';
import { createLoadingGate } from '@uxcommon/loading-gate';

import {
  groupForWalk,
  orderForWalk,
  simplifyPath,
  type JoinCodeQr,
  type LatLng,
  type WalkStreetGroup,
} from '../../../../../../../libs/common/src';
import { environment } from '../../../../environments/environment';
import { CanvassingService, type TurfDetail, type TurfDoor } from '../services/canvassing-service';
import { JoinCodesService } from '../../volunteer-access/services/join-codes-service';
import { OrgModeService } from '../../../services/org-mode.service';

type DoorStatus = TurfDoor['status'];

/** Plain words for the paper: no badges, no colour, nothing that needs a legend. */
const DOOR_WORD: Record<DoorStatus, string> = {
  conversation: 'Talked',
  attempted: 'Knocked, no answer',
  not_yet: 'To walk',
};

/** Auto-minted print codes live 30 days — long enough for a canvass wave, never permanent (REVIEW7 E1). */
const PRINT_JOIN_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The map's drawing box, sized to the Static Maps free-tier ceiling (640×640 CSS px)
 * so the basemap image and the SVG overlay are always the same rectangle.
 */
const MAP_WIDTH = 640;
const MAP_HEIGHT = 440;
const MAP_PADDING = 30;
/** Doubles the image's pixel density (not its coordinate space) so paper stays sharp. */
const STATIC_MAP_SCALE = 2;
/** A one-door turf frames a block, not a rooftop. */
const STATIC_MAP_MAX_ZOOM = 17;
const STATIC_MAP_MIN_ZOOM = 3;
const WORLD_TILE_PX = 256;
const DOT_RADIUS = 7;
/** Half-width of the X drawn over a door nobody may contact. */
const CROSS_ARM = 4.5;
/** How far above a street's middle its name is written. */
const STREET_LABEL_LIFT = 14;
/** Street names in the header before the rest become a "+N more". */
const MAX_STREET_NAMES = 4;
const DEGREES_TO_RADIANS = Math.PI / 180;

/** One door drawn on the schematic map. Status is carried by shape, not colour. */
interface PrintDot {
  id: string;
  x: number;
  y: number;
  fill: string;
  stroke: string;
  /** The walking number written inside the dot; empty for a do-not-contact door. */
  label: string;
  labelFill: string;
  crossed: boolean;
}

interface PrintPath {
  id: string;
  d: string;
}

interface PrintLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** "Start" / "End", placed on the first and last door still to walk. */
interface PrintTag {
  id: string;
  x: number;
  y: number;
  text: string;
}

interface PrintMap {
  dots: PrintDot[];
  paths: PrintPath[];
  streets: PrintLabel[];
  tags: PrintTag[];
  /** The Google street image under the overlay, or null when the workspace has no key. */
  imageUrl: string | null;
}

/** Web Mercator world fractions — the projection the Static Maps image itself uses. */
function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  return 0.5 - Math.asinh(Math.tan(lat * DEGREES_TO_RADIANS)) / (2 * Math.PI);
}

/** A door with coordinates, narrowed once so nothing downstream re-checks for null. */
interface PlacedDoor {
  door: TurfDoor;
  point: LatLng;
}

function placed(doors: readonly TurfDoor[]): PlacedDoor[] {
  const out: PlacedDoor[] = [];
  for (const door of doors) {
    if (door.lat == null || door.lng == null) continue;
    out.push({ door, point: { lat: Number(door.lat), lng: Number(door.lng) } });
  }
  return out;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Everyone on file here has asked not to be contacted, so the door is crossed out. */
function isDoNotContact(door: TurfDoor): boolean {
  return door.residents.length > 0 && door.residents.every((r) => r.dnc);
}

/**
 * The printable walk sheet for one turf (§13.1): the doors in walking order, a schematic
 * map, and blank columns to write in.
 *
 * Paper is the fallback every canvass still needs — a dead phone, a volunteer with no
 * smartphone, a rural turf with no signal. Everything here is derived from the same
 * shared walking order the turf page and the Canvass Companion use, so door 3 on paper
 * is door 3 on the phone.
 */
@Component({
  selector: 'pc-turf-print-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Qr, RouterLink],
  templateUrl: './turf-print-page.html',
  styles: [
    `
      @media print {
        /* Room to write, and a ruled grid to write inside. */
        .pc-walk-table th,
        .pc-walk-table td {
          border: 1px solid #000;
          height: 9mm;
        }
        /* The shared table shell is screen chrome. On paper it is a scroll container,
           and a scroll container cannot break across pages — strip it so the table
           paginates with its header repeating. */
        .pc-walk-shell {
          border: none;
          border-radius: 0;
          background: transparent;
          overflow: visible;
        }
        /* A map split across two pages is two useless halves. */
        .pc-walk-map {
          break-inside: avoid;
        }
      }
    `,
  ],
})
export class TurfPrintPage {
  public readonly id = input.required<string>();

  private readonly svc = inject(CanvassingService);
  private readonly joinCodes = inject(JoinCodesService);
  private readonly alerts = inject(AlertService);
  private readonly breadcrumbs = inject(BreadcrumbsService);
  private readonly orgMode = inject(OrgModeService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;

  protected readonly detail = signal<TurfDetail | null>(null);
  /** Null whenever the code could not be fetched or made — the sheet prints without it. */
  protected readonly qr = signal<JoinCodeQr | null>(null);
  protected readonly printedAt = new Date();
  protected readonly mapWidth = MAP_WIDTH;
  protected readonly mapHeight = MAP_HEIGHT;
  protected readonly dotRadius = DOT_RADIUS;
  /** Flips when the Google image 403s or times out; the overlay then stands alone. */
  protected readonly basemapFailed = signal(false);
  protected readonly crossArm = CROSS_ARM;
  protected readonly doorWord = DOOR_WORD;

  constructor() {
    // Load once the router has bound the required `id` input — reading it in the
    // constructor throws NG0950. Re-runs when the id changes.
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });

    effect(() => {
      const d = this.detail();
      if (!d) return;
      this.breadcrumbs.setCrumbs([
        { label: this.orgMode.term('nav.canvassing'), route: '/canvassing' },
        { label: d.name, route: `/canvassing/${d.id}` },
        { label: 'Print walk map' },
      ]);
    });
  }

  /** Streets in the order they should be walked, each street's doors in order. */
  protected readonly groups = computed<WalkStreetGroup<TurfDoor>[]>(() => groupForWalk(this.detail()?.doors ?? []));

  /** The whole turf flattened into one walking order — the numbers printed on the sheet. */
  protected readonly walkDoors = computed<TurfDoor[]>(() => orderForWalk(this.detail()?.doors ?? []));

  /**
   * Door numbers as the PHONE numbers them: restarting at 1 on each street, and a building's
   * units sharing one number. The old whole-turf per-unit numbering meant "door 12" on paper
   * was a different address than door 12 on a volunteer's phone — the phone scopes its list to
   * one street and folds apartment units into a single row, so a 40-unit building offset every
   * later number by 39 (REVIEW7 E3). Units are adjacent within a street's walking order, so a
   * consecutive run of the same house number is one building.
   */
  protected readonly walkSeq = computed<Map<string, number>>(() => {
    const seq = new Map<string, number>();
    for (const group of this.groups()) {
      let n = 0;
      let lastBuildingKey: string | null = null;
      for (const door of group.doors) {
        const num = door.street_num?.trim().toLowerCase();
        const buildingKey = num ? `num:${num}` : `hh:${door.household_id}`;
        if (buildingKey !== lastBuildingKey) {
          n += 1;
          lastBuildingKey = buildingKey;
        }
        seq.set(door.household_id, n);
      }
    }
    return seq;
  });

  protected readonly toWalkCount = computed<number>(
    () => this.walkDoors().filter((d) => d.status === 'not_yet').length,
  );

  protected readonly ungeocoded = computed<number>(
    () => this.walkDoors().filter((d) => d.lat == null || d.lng == null).length,
  );

  /** The address to knock on first, so nobody has to work out where the walk begins. */
  protected readonly startAddress = computed<string | null>(
    () => this.walkDoors().find((d) => d.status === 'not_yet')?.address ?? null,
  );

  protected readonly streetsLine = computed<string>(() => {
    const names = this.groups().map((g) => this.groupName(g));
    const shown = names.slice(0, MAX_STREET_NAMES);
    const extra = names.length - shown.length;
    return extra > 0 ? `${shown.join(' · ')} +${extra} more` : shown.join(' · ');
  });

  /** The campaign's own word for the area, plus which area this turf sits in. */
  protected readonly areaLine = computed<string>(() => {
    const d = this.detail();
    if (!d) return '';
    if (d.boundary_name) return `${d.boundary_label}: ${d.boundary_name}`;
    if (d.boundary_set_id) return `Outside every ${d.boundary_label.toLowerCase()}`;
    return 'No boundary map';
  });

  /**
   * The walk map: a Google street image with door dots, ONE dashed line through the
   * doors still to walk in walking order, and the start and end of the walk drawn on
   * top of it. Without a key (or when the image fails to load) the same overlay
   * renders alone as a schematic, with street names standing in for the basemap.
   *
   * The line deliberately runs across streets — on paper it is the entire guidance,
   * exactly what the hand-drawn arrows on a classic walk sheet do — and it is
   * simplified to real turns, never one segment per door. The overlay projects with
   * the image's own Web Mercator at the image's own integer zoom, so a dot lands on
   * the house it belongs to.
   */
  protected readonly printMap = computed<PrintMap | null>(() => {
    const all = placed(this.walkDoors());
    if (all.length === 0) return null;

    const xs = all.map((p) => mercatorX(p.point.lng));
    const ys = all.map((p) => mercatorY(p.point.lat));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // The largest integer zoom (Static Maps accepts no other kind) that fits every
    // door inside the padded box. A single door has zero span and stays at the cap.
    let zoom = STATIC_MAP_MAX_ZOOM;
    while (zoom > STATIC_MAP_MIN_ZOOM) {
      const world = WORLD_TILE_PX * 2 ** zoom;
      const fitsX = (maxX - minX) * world <= MAP_WIDTH - MAP_PADDING * 2;
      const fitsY = (maxY - minY) * world <= MAP_HEIGHT - MAP_PADDING * 2;
      if (fitsX && fitsY) break;
      zoom--;
    }
    const world = WORLD_TILE_PX * 2 ** zoom;

    const project = (point: LatLng): { x: number; y: number } => ({
      x: round(MAP_WIDTH / 2 + (mercatorX(point.lng) - centerX) * world),
      y: round(MAP_HEIGHT / 2 + (mercatorY(point.lat) - centerY) * world),
    });

    const centerLng = centerX * 360 - 180;
    const centerLat = Math.atan(Math.sinh(2 * Math.PI * (0.5 - centerY))) / DEGREES_TO_RADIANS;
    const key = environment.googleMapsApiKey;
    // Grayscale, POI labels off: the basemap is context, the black route is the message.
    const imageUrl = key
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat.toFixed(6)},${centerLng.toFixed(6)}` +
        `&zoom=${zoom}&size=${MAP_WIDTH}x${MAP_HEIGHT}&scale=${STATIC_MAP_SCALE}&maptype=roadmap` +
        `&style=saturation:-100&style=feature:poi%7Celement:labels%7Cvisibility:off&key=${key}`
      : null;

    const seq = this.walkSeq();
    const dots: PrintDot[] = all.map(({ door, point }) => {
      const at = project(point);
      const number = String(seq.get(door.household_id) ?? '');
      if (isDoNotContact(door)) {
        return {
          id: door.household_id,
          ...at,
          fill: '#ffffff',
          stroke: '#000000',
          label: '',
          labelFill: '#000000',
          crossed: true,
        };
      }
      if (door.status === 'conversation') {
        return {
          id: door.household_id,
          ...at,
          fill: '#000000',
          stroke: '#000000',
          label: number,
          labelFill: '#ffffff',
          crossed: false,
        };
      }
      if (door.status === 'attempted') {
        return {
          id: door.household_id,
          ...at,
          fill: '#999999',
          stroke: '#000000',
          label: number,
          labelFill: '#ffffff',
          crossed: false,
        };
      }
      return {
        id: door.household_id,
        ...at,
        fill: '#ffffff',
        stroke: '#000000',
        label: number,
        labelFill: '#000000',
        crossed: false,
      };
    });

    const streets: PrintLabel[] = [];
    for (const group of this.groups()) {
      const onStreet = placed(group.doors);
      if (onStreet.length === 0) continue;
      const points = onStreet.map((p) => project(p.point));
      streets.push({
        id: group.key,
        x: round(points.reduce((sum, p) => sum + p.x, 0) / points.length),
        y: round(points.reduce((sum, p) => sum + p.y, 0) / points.length - STREET_LABEL_LIFT),
        text: this.groupName(group),
      });
    }

    const toWalk = placed(this.walkDoors().filter((d) => d.status === 'not_yet'));
    const paths: PrintPath[] = [];
    // A turf with NOTHING left still prints the walking shape — through every door — so a
    // finished (or demo) turf reads as a walked route, not a scatter of dots. But with exactly
    // one door remaining, no line: the old fallback drew the route through already-walked doors,
    // which read as "still to do" (REVIEW7 E5); the lone remaining dot needs no route.
    const routeSource = toWalk.length >= 2 ? toWalk : toWalk.length === 0 ? all : [];
    const route = simplifyPath(routeSource.map((p) => p.point)).map(project);
    if (route.length >= 2) {
      paths.push({
        id: 'walk-route',
        d: route.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
      });
    }

    const tags: PrintTag[] = [];
    const first = toWalk[0];
    const last = toWalk[toWalk.length - 1];
    if (first) {
      const at = project(first.point);
      tags.push({ id: 'start', x: at.x + DOT_RADIUS + 3, y: at.y - DOT_RADIUS, text: 'Start' });
    }
    if (last && toWalk.length > 1) {
      const at = project(last.point);
      tags.push({ id: 'end', x: at.x + DOT_RADIUS + 3, y: at.y - DOT_RADIUS, text: 'End' });
    }

    return { dots, paths, streets, tags, imageUrl };
  });

  protected groupName(group: WalkStreetGroup<TurfDoor>): string {
    return group.street || 'No street on file';
  }

  protected seqOf(door: TurfDoor): number {
    return this.walkSeq().get(door.household_id) ?? 0;
  }

  /** "Ada Lovelace, Alan Turing (do not contact)" — one cell, no badges to print. */
  protected residentsOf(door: TurfDoor): string {
    if (door.residents.length === 0) return '';
    return door.residents.map((r) => (r.dnc ? `${r.name} (do not contact)` : r.name)).join(', ');
  }

  protected print(): void {
    window.print();
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    this.basemapFailed.set(false);
    try {
      const detail = await this.svc.getTurfDetail(this.id());
      this.detail.set(detail);
      await this.loadQr(detail);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load this turf.');
    } finally {
      end();
    }
  }

  /**
   * Best effort only. A volunteer with a phone can scan this instead of writing on the
   * sheet, but a sheet that will not print because the code service is down is worse
   * than a sheet with no code on it, so every failure here is silent.
   */
  private async loadQr(detail: TurfDetail): Promise<void> {
    try {
      // `silent` keeps the shared tRPC error handler from toasting: a workspace whose
      // plan has no companion access must still print a clean sheet, minus the code.
      //
      // The TURF's campaign, not the selected one: filing the code under whichever campaign
      // happened to be active minted a second live code for the same turf and attached
      // redeeming volunteers to the wrong campaign (REVIEW7 E4). And a 30-day expiry: this
      // code is minted by merely opening the print view and is typed/scannable off a paper
      // sheet, so it must not be a permanent credential — reprinting after expiry simply
      // mints a fresh one (REVIEW7 E1).
      const turfCampaignId = detail.campaign_id ?? null;
      const rows = await this.joinCodes.getForCampaign({ silent: true }, turfCampaignId);
      const code =
        rows.find((r) => r.status === 'active' && (r.turf_id ?? null) === detail.id) ??
        (await this.joinCodes.create(
          {
            turf_id: detail.id,
            label: detail.name,
            expires_at: new Date(Date.now() + PRINT_JOIN_CODE_TTL_MS).toISOString(),
          },
          { silent: true },
          turfCampaignId,
        ));
      this.qr.set(await this.joinCodes.qr(code.id, { silent: true }));
    } catch {
      this.qr.set(null);
    }
  }
}
