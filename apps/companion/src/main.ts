import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));

/**
 * Register the offline shell (see src/sw.js).
 *
 * After bootstrap, not before: the worker is what makes a *later* visit work offline, so there is
 * no reason to let its registration compete with first paint on a volunteer's phone.
 *
 * Production only. In dev the worker would serve stale bundles over the live-reload server, which
 * is a confusing way to lose an afternoon.
 */
if (environment.production && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      // Non-fatal: the app works online exactly as before, it just will not survive a dead-zone
      // reload. Worth a console line so it is diagnosable, not worth interrupting a shift.
      console.error('Companion service worker registration failed', err);
    });
  });
}
