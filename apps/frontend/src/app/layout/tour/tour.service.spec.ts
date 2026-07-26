import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../auth/auth-service';
import { TOUR_STOPS } from './tour-stops';
import { TourService } from './tour.service';

describe('TourService', () => {
  let user: ReturnType<typeof signal<Record<string, unknown> | null>>;
  let service: TourService;
  let getState: ReturnType<typeof vi.fn>;
  let setState: ReturnType<typeof vi.fn>;

  const build = (): TourService => {
    // Reset first: several tests re-build with different stored state, and TestBed refuses to be
    // reconfigured once instantiated.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // Real stub routes for the destinations the tour walks between, so navigation is
        // exercised rather than silently swallowed by the service's guard.
        provideRouter(
          ['dashboard', 'people', 'lists', 'newsletters', 'canvassing'].map((path) => ({ path, children: [] })),
        ),
        { provide: AuthService, useValue: { getUserSignal: () => user } },
      ],
    });
    const svc = TestBed.inject(TourService);
    // Stub the tRPC seam rather than the service's own logic.
    (svc as unknown as { api: unknown }).api = {
      auth: { getTourState: { query: getState }, setTourState: { mutate: setState } },
    };
    return svc;
  };

  beforeEach(() => {
    user = signal<Record<string, unknown> | null>({ tenant_demo_mode_at: new Date(), role: 'admin' });
    getState = vi.fn().mockResolvedValue({ lastStep: 0, startedAt: null, completedAt: null, dismissedAt: null });
    setState = vi.fn().mockResolvedValue({});
    vi.stubGlobal('innerWidth', 1280);
    service = build();
  });

  describe('auto-start', () => {
    it('starts once for a demo workspace that has never been offered the tour', async () => {
      await service.maybeAutoStart();
      expect(service.active()).toBe(true);
    });

    /** Every stop lands on a seeded record. Outside demo mode there is nothing to point at. */
    it('does not start outside demo mode', async () => {
      user.set({ tenant_demo_mode_at: null, role: 'admin' });
      await service.maybeAutoStart();
      expect(service.active()).toBe(false);
    });

    it('does not start again after the user skipped', async () => {
      getState.mockResolvedValue({
        lastStep: 2,
        startedAt: '2026-01-01',
        completedAt: null,
        dismissedAt: '2026-01-01',
      });
      service = build();

      await service.maybeAutoStart();
      expect(service.active()).toBe(false);
    });

    it('does not start again after the user finished it', async () => {
      getState.mockResolvedValue({
        lastStep: 6,
        startedAt: '2026-01-01',
        completedAt: '2026-01-01',
        dismissedAt: null,
      });
      service = build();

      await service.maybeAutoStart();
      expect(service.active()).toBe(false);
    });

    /** Anchored bubbles have nowhere sensible to sit on a phone, and the CRM is a desktop
     * product — the mobile surfaces are the companion apps. */
    it('does not take over a small viewport', async () => {
      vi.stubGlobal('innerWidth', 480);
      await service.maybeAutoStart();
      expect(service.active()).toBe(false);
    });

    it('can still be started by hand after a skip', async () => {
      getState.mockResolvedValue({
        lastStep: 3,
        startedAt: '2026-01-01',
        completedAt: null,
        dismissedAt: '2026-01-01',
      });
      service = build();

      await service.start(true);
      expect(service.active()).toBe(true);
      expect(service.index()).toBe(0);
    });
  });

  describe('navigation', () => {
    it('resumes where it left off, and finishes on the last stop', async () => {
      getState.mockResolvedValue({ lastStep: 5, startedAt: '2026-01-01', completedAt: null, dismissedAt: null });
      service = build();

      await service.start();
      expect(service.index()).toBe(5);

      await service.next();
      expect(service.isLast()).toBe(true);

      await service.next();
      expect(service.active()).toBe(false);
      expect(setState).toHaveBeenCalledWith(expect.objectContaining({ completedAt: expect.any(String) }));
    });

    it('will not step back past the first stop', async () => {
      await service.start(true);
      await service.previous();
      expect(service.index()).toBe(0);
    });

    it('ignores an out-of-range jump', async () => {
      await service.start(true);
      await service.goTo(99);
      expect(service.index()).toBe(0);
    });
  });

  it('exposes the current stop’s anchor only while running', async () => {
    await service.start(true);
    expect(service.activeAnchor()).toBe(TOUR_STOPS[0]?.anchor ?? null);

    await service.skip();
    expect(service.activeAnchor()).toBeNull();
  });

  /** Showing a viewer an action they will be refused is a dead end delivered in advance. */
  it('uses viewer copy for a viewer', async () => {
    user.set({ tenant_demo_mode_at: new Date(), role: 'viewer' });
    await service.start(true);
    await service.next();

    expect(service.body()).toBe(TOUR_STOPS[1]?.viewerBody);
    expect(service.body()).not.toContain('double-clicking');
  });

  it('uses the default copy for an admin', async () => {
    await service.start(true);
    await service.next();
    expect(service.body()).toBe(TOUR_STOPS[1]?.body);
  });

  /** A tour is a nicety. Failing to read or write its progress must never block the shell. */
  it('survives a failing progress endpoint', async () => {
    getState.mockRejectedValue(new Error('offline'));
    setState.mockRejectedValue(new Error('offline'));
    service = build();

    await expect(service.maybeAutoStart()).resolves.toBeUndefined();
    expect(service.active()).toBe(true);
    await expect(service.next()).resolves.toBeUndefined();
  });
});
