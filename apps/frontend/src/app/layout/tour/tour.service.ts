import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../auth/auth-service';
import { TRPCService } from '../../services/api/trpc-service';
import { TOUR_STOPS, type TourStop } from './tour-stops';

interface TourState {
  lastStep: number;
  startedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
}

const EMPTY_STATE: TourState = { lastStep: 0, startedAt: null, completedAt: null, dismissedAt: null };

/** Below this width the anchored bubble has nowhere sensible to sit, so the tour offers itself
 * rather than taking over. The CRM is a desktop product; the mobile surfaces are the companions. */
const MIN_TOUR_WIDTH = 640;

/**
 * Runs the product tour.
 *
 * Progress is per USER and stored on the profile, so a person learns the app once rather than
 * once per browser — the flaw in the old localStorage-only checklist dismissal, which we
 * deliberately did not repeat.
 */
@Service()
export class TourService extends TRPCService<any> {
  private readonly auth = inject(AuthService);
  private readonly appRouter = inject(Router);

  private readonly user = this.auth.getUserSignal();

  private readonly _state = signal<TourState>(EMPTY_STATE);
  private readonly _index = signal(0);
  private readonly _active = signal(false);
  private readonly _loaded = signal(false);

  public readonly active = this._active.asReadonly();
  public readonly index = this._index.asReadonly();
  public readonly stops = TOUR_STOPS;
  public readonly stop = computed<TourStop | null>(() => TOUR_STOPS[this._index()] ?? null);
  public readonly isLast = computed(() => this._index() === TOUR_STOPS.length - 1);

  /** Anchor id of the stop being shown, so the directive knows which element to spotlight. */
  public readonly activeAnchor = computed(() => (this._active() ? (this.stop()?.anchor ?? null) : null));

  private readonly isDemo = computed(() => !!this.user()?.tenant_demo_mode_at);
  private readonly isViewer = computed(() => (this.user()?.role ?? '').toLowerCase() === 'viewer');

  /** The tour has been offered before, however it ended. */
  public readonly hasBeenOffered = computed(
    () => !!this._state().startedAt || !!this._state().completedAt || !!this._state().dismissedAt,
  );

  /** Body copy for the current stop, adapted for viewers: showing someone an action they will be
   * refused is a dead end delivered in advance. */
  public readonly body = computed(() => {
    const stop = this.stop();
    if (!stop) return '';
    return this.isViewer() && stop.viewerBody ? stop.viewerBody : stop.body;
  });

  public readonly canRunHere = computed(() => typeof window !== 'undefined' && window.innerWidth >= MIN_TOUR_WIDTH);

  /**
   * Auto-start exactly once: first time a demo-mode user reaches the shell and the tour has never
   * been offered. Never on a later sign-in, never after a skip.
   *
   * Still gated on demo mode, deliberately. Modes that skip the demo dataset (see
   * ORG_MODE_SEEDS_DEMO) get no tour, which is correct: every stop's copy describes seeded
   * records ("one newsletter was already sent for you"), so running it on an empty workspace
   * would narrate things that are not there. Those workspaces are onboarded by the go-live
   * wizard and the dashboard checklist instead. A mode-neutral tour is its own piece of work.
   */
  public async maybeAutoStart(): Promise<void> {
    await this.load();
    if (!this.isDemo() || this.hasBeenOffered() || !this.canRunHere()) return;
    await this.start();
  }

  public async load(): Promise<void> {
    if (this._loaded()) return;
    try {
      const state = await this.api.auth.getTourState.query();
      this._state.set({ ...EMPTY_STATE, ...state });
    } catch {
      // A tour is a nicety; failing to read its progress must never block the shell.
    }
    this._loaded.set(true);
  }

  public async start(fromBeginning = false): Promise<void> {
    await this.load();
    const resumeAt = fromBeginning ? 0 : Math.min(this._state().lastStep, TOUR_STOPS.length - 1);
    this._index.set(resumeAt);
    this._active.set(true);
    await this.persist({ startedAt: this._state().startedAt ?? new Date().toISOString() });
    await this.navigateToStop();
  }

  public async next(): Promise<void> {
    if (this.isLast()) {
      await this.complete();
      return;
    }
    this._index.update((i) => i + 1);
    await this.persist({ lastStep: this._index() });
    await this.navigateToStop();
  }

  public async previous(): Promise<void> {
    if (this._index() === 0) return;
    this._index.update((i) => i - 1);
    await this.persist({ lastStep: this._index() });
    await this.navigateToStop();
  }

  public async goTo(index: number): Promise<void> {
    if (index < 0 || index >= TOUR_STOPS.length) return;
    this._index.set(index);
    await this.persist({ lastStep: index });
    await this.navigateToStop();
  }

  /** Leaving is not failure, so it is not worth a confirm dialog. */
  public async skip(): Promise<void> {
    this._active.set(false);
    await this.persist({ dismissedAt: new Date().toISOString(), lastStep: this._index() });
  }

  public async complete(): Promise<void> {
    this._active.set(false);
    await this.persist({ completedAt: new Date().toISOString(), lastStep: TOUR_STOPS.length - 1 });
  }

  private async navigateToStop(): Promise<void> {
    const route = this.stop()?.route;
    if (!route || this.appRouter.url.split('?')[0] === route) return;
    try {
      await this.appRouter.navigateByUrl(route);
    } catch {
      // A stop whose route will not resolve (a guard turns it away, a lazy chunk fails) must not
      // end the tour. The bubble still explains the feature; the user simply does not travel.
    }
  }

  private async persist(patch: Partial<TourState>): Promise<void> {
    this._state.update((s) => ({ ...s, ...patch }));
    try {
      await this.api.auth.setTourState.mutate(patch);
    } catch {
      // Same reasoning as loading: progress is a convenience, not a gate.
    }
  }
}
