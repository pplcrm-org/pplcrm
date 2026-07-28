import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import type { LatLng } from '@common';

/** How stale a fix may be before the browser re-measures rather than replaying a cache. */
const MAX_FIX_AGE_MS = 30_000;
const FIX_TIMEOUT_MS = 10_000;

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
 * refuse reflexively, and a refusal is sticky. It fires only on an explicit tap.
 */
@Injectable({ providedIn: 'root' })
export class GeoPosition {
  private readonly _coords = signal<LatLng | null>(null);
  private readonly _state = signal<'unsupported' | 'prompt' | 'locating' | 'ready' | 'denied'>(
    typeof navigator === 'undefined' || !navigator.geolocation ? 'unsupported' : 'prompt',
  );

  public readonly coords = computed(() => this._coords());
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
        this._coords.set({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        this._state.set('ready');
      },
      () => {
        // Denied, timed out, or position unavailable all land here. They are the same
        // thing to a caller: there is no fix, carry on with the stated fallback order.
        this._coords.set(null);
        this._state.set('denied');
        this.stop();
      },
      { enableHighAccuracy: false, maximumAge: MAX_FIX_AGE_MS, timeout: FIX_TIMEOUT_MS },
    );
  }

  public stop(): void {
    if (this.watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }
}
