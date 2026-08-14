import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { isPrivilegedRole } from '@common';
import { formatWalkDistance } from '@common';
import { PcMap } from '@uxcommon/components/map/map';

import { AuthService } from '../../../auth/auth-service';
import { CanvassingService, type PersonCanvassLive } from '../../canvassing/services/canvassing-service';

import type { PcMapMarker, PcMapPolyline } from '@uxcommon/components/map/map-types';

/** Same cadence as the Live tab: pings arrive every minute, so 30 s halves the lag. */
const POLL_MS = 30_000;

function agoLabel(iso: string | null): string {
  if (!iso) return 'no ping yet';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

/**
 * The person page's canvassing block (Live spec §5). Renders ONLY for admin/owner —
 * the same permission as the Live tab; the server refuses editors regardless — and only
 * when there is something to say: an open shift, or work walked today. While a shift is
 * open it shows the OUT NOW pill, the street map with today's path, and four figures;
 * closed, the figures alone remain. Coordinates never outlive the day.
 */
@Component({
  selector: 'pc-person-canvass-live',
  imports: [PcMap, RouterLink],
  template: `
    @if (visible() && data(); as d) {
      <div class="card border border-base-300 bg-base-100 p-4">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <h3 class="pc-eyebrow">Canvassing today</h3>
          @if (d.open; as open) {
            <span class="rounded-full bg-live px-2 py-0.5 text-[10px] font-bold tracking-wide text-live-content">
              OUT NOW
            </span>
            <span class="text-xs text-base-content/70">
              On
              <a class="text-primary hover:underline" [routerLink]="['/canvassing', open.turf_id]">{{
                open.turf_name
              }}</a>
              since {{ sinceLabel(open.started_at) }} · last ping {{ lastPingLabel(open.last_ping_at) }}
            </span>
          }
        </div>

        @if (showMap()) {
          <pc-map
            class="mb-3 block h-52 w-full rounded-lg"
            [markers]="markers()"
            [polylines]="polylines()"
            ariaLabel="Today's canvassing path"
          >
          </pc-map>
          <p class="mb-3 text-xs text-base-content/50">
            Today's path only, cleared at midnight. Nothing shows here when their shift is closed.
          </p>
        }

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div class="text-lg font-semibold tabular-nums">{{ d.today.doors }}</div>
            <div class="text-xs text-base-content/60">Doors today</div>
          </div>
          <div>
            <div class="text-lg font-semibold tabular-nums">{{ d.today.conversations }}</div>
            <div class="text-xs text-base-content/60">Conversations</div>
          </div>
          <div>
            <div class="text-lg font-semibold tabular-nums">{{ d.today.support_ids }}</div>
            <div class="text-xs text-base-content/60">Support IDs</div>
          </div>
          <div>
            <div class="text-lg font-semibold tabular-nums">{{ distanceLabel() }}</div>
            <div class="text-xs text-base-content/60">Distance walked</div>
          </div>
        </div>
      </div>
    }
  `,
})
export class PersonCanvassLiveCard {
  public readonly personId = input.required<string>();

  private readonly svc = inject(CanvassingService);
  private readonly auth = inject(AuthService);

  protected readonly data = signal<PersonCanvassLive | null>(null);

  private readonly allowed = computed(() => isPrivilegedRole(this.auth.getUserSignal()()?.role));

  protected readonly visible = computed<boolean>(() => {
    if (!this.allowed()) return false;
    const d = this.data();
    if (!d) return false;
    return d.open != null || d.today.doors > 0 || d.today.conversations > 0 || d.today.distance_m > 0;
  });

  protected readonly showMap = computed<boolean>(() => {
    const open = this.data()?.open;
    return open != null && open.precision === 'street' && (open.position != null || (open.path?.length ?? 0) > 1);
  });

  protected readonly markers = computed<PcMapMarker[]>(() => {
    const open = this.data()?.open;
    if (!open?.position) return [];
    return [
      { position: open.position, variant: 'live', size: 22, tooltip: `Last ping ${agoLabel(open.last_ping_at)}` },
    ];
  });

  protected readonly polylines = computed<PcMapPolyline[]>(() => {
    const path = this.data()?.open?.path;
    if (!path || path.length < 2) return [];
    return [{ path, variant: 'live', dashed: false }];
  });

  protected readonly distanceLabel = computed(() => formatWalkDistance(this.data()?.today.distance_m ?? 0));

  constructor() {
    effect(() => {
      const id = this.personId();
      if (this.allowed()) void this.load(id);
    });
    const timer = setInterval(() => {
      if (!document.hidden && this.allowed() && this.data()?.open) void this.load(this.personId());
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected sinceLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  protected lastPingLabel(iso: string | null): string {
    return agoLabel(iso);
  }

  private async load(personId: string): Promise<void> {
    try {
      this.data.set(await this.svc.getPersonLive(personId));
    } catch {
      // Plan-gated, module off, or a transient failure — the card simply doesn't render.
      this.data.set(null);
    }
  }
}
