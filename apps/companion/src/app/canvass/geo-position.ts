import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import type { LatLng } from '@common';

/** How stale a fix may be before the browser re-measures rather than replaying a cache. */
const MAX_FIX_AGE_MS = 30_000;
const FIX_TIMEOUT_MS = 10_000;

/** One measured position, with what the location broadcast needs alongside the point. */
export interface GeoFix extends LatLng {
  /** Reported accuracy radius in metres; null when the browser gave none. */
  accuracy_m: number | null;
  /** Device clock at measurement (the browser fix timestamp). */
  at: Date;
}

/**
 * Where the phone is, as a signal.
 *
 * `unsupported` — no geolocation API at all (or a non-secure context).
 * `prompt`      — available, not yet asked. **Nothing happens until `request()`.**
 * `locating`    — asked, waiting for the first fix.
 * `ready`       — `coords()` is live and keeps updating.
 * `denied`      — refused or unavailable; every caller falls back to a stated order.
 *
 * Deliberately never prompts on load. A permission dialog thrown up on first paint —
 * before the volunteer has done anything or knows why — is the kind of thing people
 * refuse reflexively, and a refusal is sticky. It fires on an explicit tap, or when a
 * turf opens (the store starts the location broadcast — the volunteer has just been told
 * the campaign sees their position, so the prompt has its context).
 */
@Injectable({ providedIn: 'root' })
export class GeoPosition {
  private readonly _fix = signal<GeoFix | null>(null);
  private readonly _state = signal<'unsupported' | 'prompt' | 'locating' | 'ready' | 'denied'>(
    typeof navigator === 'undefined' || !navigator.geolocation ? 'unsupported' : 'prompt',
  );

  /** The full current fix (position + accuracy + device time), for the broadcast. */
  public readonly fix = computed(() => this._fix());
  public readonly coords = computed<LatLng | null>(() => {
    const fix = this._fix();
    return fix ? { lat: fix.lat, lng: fix.lng } : null;
  });
  public readonly state = computed(() => this._state());

  private watchId: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Ask for location. Safe to call repeatedly — only the first call starts a watch. */
  public request(): void {
    if (this._state() !== 'prompt' && this._state() !== 'denied') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this._state.set('unsupported');
      return;
    }
    this._state.set('locating');
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this._fix.set({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          at: new Date(pos.timestamp),
        });
        this._state.set('ready');
      },
      () => {
        // Denied, timed out, or position unavailable all land here. They are the same
        // thing to a caller: there is no fix, carry on with the stated fallback order.
        this._fix.set(null);
        this._state.set('denied');
        this.stop();
      },
      { enableHighAccuracy: false, maximumAge: MAX_FIX_AGE_MS, timeout: FIX_TIMEOUT_MS },
    );
  }

  /**
   * Stop watching and forget the fix. Resets `state` to `prompt` (never leaves it at
   * `ready` with a dead watch — a "sharing" indicator reading that state would be lying).
   * A `denied` verdict is kept: stopping doesn't un-refuse the permission.
   */
  public stop(): void {
    if (this.watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    const wasWatching = this.watchId != null;
    this.watchId = null;
    this._fix.set(null);
    if (wasWatching && (this._state() === 'ready' || this._state() === 'locating')) {
      this._state.set('prompt');
    }
  }
}
