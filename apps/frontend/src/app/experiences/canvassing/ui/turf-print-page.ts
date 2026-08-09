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

/** The schematic map's drawing box. Fixed, so the sheet lays out the same every time. */
const MAP_WIDTH = 760;
const MAP_HEIGHT = 520;
const MAP_PADDING = 30;
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

  protected readonly walkSeq = computed<Map<string, number>>(() => {
    const seq = new Map<string, number>();
    this.walkDoors().forEach((d, i) => seq.set(d.household_id, i + 1));
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
   * The schematic map: door dots, one dashed line per street, street names, and the
   * start and end of the walk.
   *
   * The projection is equirectangular around the middle latitude of the turf, which is
   * accurate enough over a few city blocks and needs no map tiles. Roads are not drawn
   * at all, which is why the caption under it says so.
   */
  protected readonly printMap = computed<PrintMap | null>(() => {
    const all = placed(this.walkDoors());
    if (all.length === 0) return null;

    const lats = all.map((p) => p.point.lat);
    const lngs = all.map((p) => p.point.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLat = lats.reduce((sum, v) => sum + v, 0) / lats.length;
    const lngScale = Math.cos(midLat * DEGREES_TO_RADIANS);

    const rawWidth = (maxLng - minLng) * lngScale;
    const rawHeight = maxLat - minLat;
    const innerWidth = MAP_WIDTH - MAP_PADDING * 2;
    const innerHeight = MAP_HEIGHT - MAP_PADDING * 2;
    // A turf on one street has zero height, and a single door has zero of both. Fall back
    // to a scale of 1 so the centring maths below simply puts it in the middle.
    const fits: number[] = [];
    if (rawWidth > 0) fits.push(innerWidth / rawWidth);
    if (rawHeight > 0) fits.push(innerHeight / rawHeight);
    const scale = fits.length > 0 ? Math.min(...fits) : 1;
    const offsetX = MAP_PADDING + (innerWidth - rawWidth * scale) / 2;
    const offsetY = MAP_PADDING + (innerHeight - rawHeight * scale) / 2;

    const project = (point: LatLng): { x: number; y: number } => ({
      x: round(offsetX + (point.lng - minLng) * lngScale * scale),
      y: round(offsetY + (maxLat - point.lat) * scale),
    });

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
          stroke: '#999999',
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

    const paths: PrintPath[] = [];
    const streets: PrintLabel[] = [];
    for (const group of this.groups()) {
      const onStreet = placed(group.doors);
      if (onStreet.length === 0) continue;
      const simplified = simplifyPath(onStreet.map((p) => p.point)).map(project);
      if (simplified.length >= 2) {
        paths.push({
          id: group.key,
          d: simplified.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
        });
      }
      const points = onStreet.map((p) => project(p.point));
      streets.push({
        id: group.key,
        x: round(points.reduce((sum, p) => sum + p.x, 0) / points.length),
        y: round(points.reduce((sum, p) => sum + p.y, 0) / points.length - STREET_LABEL_LIFT),
        text: this.groupName(group),
      });
    }

    const toWalk = placed(this.walkDoors().filter((d) => d.status === 'not_yet'));
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

    return { dots, paths, streets, tags };
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
      const rows = await this.joinCodes.getForCampaign();
      const code =
        rows.find((r) => r.status === 'active' && (r.turf_id ?? null) === detail.id) ??
        (await this.joinCodes.create({ turf_id: detail.id, label: detail.name }));
      this.qr.set(await this.joinCodes.qr(code.id));
    } catch {
      this.qr.set(null);
    }
  }
}
