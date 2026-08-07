import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth/auth-service';
import { dashboardRoutes } from './dashboard.routes';

/**
 * These assert the URL SHAPE the app hands the user — that every page has an address
 * that says where they are, and that the addresses pages used to have still resolve.
 *
 * `router.navigateByUrl()` runs the real matchers, redirects and guards against the real
 * route table. It resolves each `loadComponent` (importing the module) but never
 * instantiates the component, so no page DI is involved.
 */
describe('dashboardRoutes — URLs', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(dashboardRoutes),
        // roleGuard protects /workspace; an owner is the case worth exercising.
        { provide: AuthService, useValue: { getUser: () => ({ role: 'owner' }), getCurrentUser: () => null } },
      ],
    });
    router = TestBed.inject(Router);
  });

  async function go(url: string): Promise<string> {
    await router.navigateByUrl(url);
    return router.url;
  }

  describe('campaigns live under the Workspace settings section that lists them', () => {
    it('serves a campaign at /workspace/campaigns/:id', async () => {
      expect(await go('/workspace/campaigns/5')).toBe('/workspace/campaigns/5');
    });

    it('serves the campaign editor at /workspace/campaigns/:id/edit', async () => {
      expect(await go('/workspace/campaigns/5/edit')).toBe('/workspace/campaigns/5/edit');
    });

    it('serves the new-campaign form at /workspace/campaigns/add', async () => {
      expect(await go('/workspace/campaigns/add')).toBe('/workspace/campaigns/add');
    });

    // One navigation per test: the add/edit pages carry a canDeactivate guard that
    // reads the live component, and nothing is instantiated here.
    it('redirects the old campaign detail URL, keeping the id', async () => {
      expect(await go('/campaigns/5')).toBe('/workspace/campaigns/5');
    });

    it('redirects the old campaign editor URL, keeping the id', async () => {
      expect(await go('/campaigns/5/edit')).toBe('/workspace/campaigns/5/edit');
    });

    it('redirects the old new-campaign URL', async () => {
      expect(await go('/campaigns/add')).toBe('/workspace/campaigns/add');
    });

    it('redirects the old campaigns index to the Workspace section', async () => {
      expect(await go('/campaigns')).toBe('/workspace/campaigns');
    });

    it('still resolves an ordinary workspace section, which shares the same URL depth', async () => {
      expect(await go('/workspace/billing')).toBe('/workspace/billing');
    });
  });

  describe('a form editor has its own address', () => {
    it('serves the forms list, one form, its editor and the new-form stepper', async () => {
      expect(await go('/forms')).toBe('/forms');
      expect(await go('/forms/12')).toBe('/forms/12');
      expect(await go('/forms/12/edit')).toBe('/forms/12/edit');
      expect(await go('/forms/new')).toBe('/forms/new');
    });
  });

  it('serves a list at /lists/:id, which is where opening a list now goes', async () => {
    expect(await go('/lists/186')).toBe('/lists/186');
  });
});
