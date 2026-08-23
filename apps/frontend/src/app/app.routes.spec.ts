import { appRoutes } from './app.routes';

describe('appRoutes', () => {
  it('redirects the empty path to the dashboard', () => {
    const root = appRoutes.find((r) => r.path === '' && 'redirectTo' in r);
    expect(root).toMatchObject({ redirectTo: 'dashboard', pathMatch: 'full' });
  });

  it('exposes every public auth route exactly once', () => {
    const authPaths = [
      'signin',
      'signup',
      'resetpassword',
      'new-password',
      'verify-sender-email',
      'confirm-subscription',
      'verify-email',
      'cancel-deletion',
      'resume-account',
    ];
    for (const path of authPaths) {
      const matches = appRoutes.filter((r) => r.path === path);
      expect(matches, `expected exactly one route for "${path}"`).toHaveLength(1);
    }
  });

  it('exposes the donor giving-portal routes exactly once, each with its static title', () => {
    const expected = [
      { path: 'g/:token', title: 'Your giving' },
      { path: 'g', title: 'Get your giving link' },
    ];
    for (const { path, title } of expected) {
      const matches = appRoutes.filter((r) => r.path === path);
      expect(matches, `expected exactly one route for "${path}"`).toHaveLength(1);
      expect(matches[0]).toMatchObject({ title });
    }
  });

  it('guards the dashboard shell with authGuard', () => {
    const dashboard = appRoutes.find((r) => 'loadChildren' in r);
    expect(dashboard).toBeDefined();
    expect(dashboard?.canActivate).toHaveLength(1);
  });

  it('falls back to the not-found page on unmatched routes', () => {
    const fallback = appRoutes.find((r) => r.path === '**');
    expect(fallback).toBeDefined();
    expect(typeof fallback?.loadComponent).toBe('function');
  });

  it('has exactly one wildcard fallback route at the end of the list', () => {
    const last = appRoutes[appRoutes.length - 1];
    expect(last.path).toBe('**');
  });
});
