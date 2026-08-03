import type { ApplicationConfig } from '@angular/core';
import { ErrorHandler, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { ENVIRONMENT } from './environment-token';
import {
  PreloadAllModules,
  RouteReuseStrategy,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withNavigationErrorHandler,
  withPreloading,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Loader } from '@googlemaps/js-api-loader';
import { environment } from '../environments/environment';

import { appRoutes } from './app.routes';
import { AppTitleStrategy } from './services/tab-title.service';
import { CustomRouteReuseStrategy } from './routing/route-reuse-strategy';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { jsendInterceptor } from './services/jsend.interceptor';
import { GlobalErrorHandler } from './services/global-error-handler';
import { claimReloadForStaleBundle, isStaleBundleError } from './routing/stale-bundle';

export function initSession(authService: AuthService) {
  return async () => {
    await authService.init();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ENVIRONMENT, useValue: environment },
    provideTanStackQuery(new QueryClient()),
    {
      provide: Loader,
      useFactory: () => {
        const env = inject(ENVIRONMENT);
        return new Loader({
          apiKey: env.googleMapsApiKey,
          // 'drawing' is deliberately NOT loaded. Google removed DrawingManager from the Maps
          // JavaScript API at v3.65, so the library is dead weight. <pc-map>'s boundary drawing
          // places vertices from map clicks instead, which is also the only way vertex snapping
          // can work — DrawingManager only ever returned a completed shape.
          libraries: ['places'],
        });
      },
    },

    {
      provide: RouteReuseStrategy,
      useClass: CustomRouteReuseStrategy,
    },
    {
      provide: TitleStrategy,
      useClass: AppTitleStrategy,
    },
    // Preload lazy route chunks in the background after first paint so slow
    // connections don't stall on chunk download at click time.
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withPreloading(PreloadAllModules),
      // A navigation that died because its chunk would not import can only be rescued by a fresh
      // document — the failed module URL is stuck in this document's module map, so retrying the
      // same route in-page fails instantly (see routing/stale-bundle.ts). Hard-load the URL the
      // user was going to; when the claim is refused, ErrorService says so instead.
      withNavigationErrorHandler((event) => {
        if (!isStaleBundleError(event.error) || !claimReloadForStaleBundle()) return;
        window.location.assign(event.url);
      }),
    ),

    provideZonelessChangeDetection(),

    provideAppInitializer(() => {
      const initializerFn = initSession(inject(AuthService));
      return initializerFn();
    }),

    provideHttpClient(withInterceptors([jsendInterceptor])),

    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
