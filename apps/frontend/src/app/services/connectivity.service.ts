import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Whether the browser currently has a network connection.
 *
 * The CRM had no notion of this at all: when wifi dropped mid-edit every save produced a generic
 * failure and the user had to guess why. The companion app has tracked connectivity from the start
 * (canvass-store.ts) precisely because volunteers work in dead zones; the desktop app just never
 * gained the same courtesy.
 *
 * `navigator.onLine` is a floor, not a guarantee — it reports "connected to *something*", so a
 * captive portal or a dead uplink still reads as online. That is fine for the way it is used here:
 * a false negative is impossible, so anything this service calls offline really is offline, and
 * everything else falls back to the existing "can't reach the server" handling.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly _online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

  /** True while the browser reports a connection. */
  public readonly online = this._online.asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;

    const onOnline = (): void => this._online.set(true);
    const onOffline = (): void => this._online.set(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });
  }
}
