import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';

import { Icon } from '@icons/icon';

import { CompanionGate } from '../gate/companion-gate';
import { CanvassHousehold } from './canvass-household';
import { CanvassLanding } from './canvass-landing';
import { CanvassList } from './canvass-list';
import { CanvassMap } from './canvass-map';
import { CanvassMe } from './canvass-me';
import { CanvassStore } from './canvass-store';
import { CanvassSurvey } from './canvass-survey';
import { CanvassTurfPicker } from './canvass-turf-picker';

import type { PcIconNameType } from '@icons/icons.index';

type TabId = 'list' | 'map' | 'me';

/**
 * Canvass companion shell (spec §3). Sits behind the verify+approve gate;
 * everything inside is client-side view state in the store — only the token
 * is routable. The tab bar hides inside the household and survey views to
 * keep the doorstep flow linear (list → household → survey → back).
 */
@Component({
  selector: 'pc-canvass-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvassStore],
  imports: [
    CompanionGate,
    CanvassHousehold,
    CanvassLanding,
    CanvassList,
    CanvassMap,
    CanvassMe,
    CanvassSurvey,
    CanvassTurfPicker,
    Icon,
  ],
  template: `
    <pc-companion-gate [kind]="token() ? 'turf' : 'session'" [token]="token() ?? null" (ready)="onReady()">
      <!-- Outside the payload guard on purpose: the picker is how a volunteer recovers
           when the turf they arrived on is gone, so it must render with no turf loaded. -->
      @if (store.view().kind === 'picker') {
        <div class="mx-auto flex min-h-screen w-full max-w-md flex-col">
          <pc-canvass-turf-picker></pc-canvass-turf-picker>
        </div>
      } @else if (store.loadError() && !store.payload()) {
        <div class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
          <pc-icon name="exclamation-triangle" [size]="8" class="text-warning"></pc-icon>
          <h1 class="text-lg font-semibold">Couldn't load your turf</h1>
          <p class="text-base-content/70">{{ store.loadError() }}</p>
          <button type="button" class="btn btn-primary" (click)="retry()">Try again</button>
          <!-- A turf can be handed to someone else mid-shift. Ending at a dead end would
               be the wrong answer when they may well be on other turfs. -->
          <button type="button" class="btn btn-outline btn-secondary" (click)="openPicker()">
            Choose another turf
          </button>
        </div>
      } @else if (!store.payload()) {
        <div class="flex min-h-screen items-center justify-center">
          <span class="loading loading-spinner loading-md opacity-40" aria-label="Loading your turf"></span>
        </div>
      } @else {
        <div class="mx-auto flex min-h-screen w-full max-w-md flex-col" [class.pb-20]="tabsVisible()">
          @if (!store.online()) {
            <div
              class="sticky top-0 z-20 bg-warning px-4 py-2 text-center text-xs font-medium text-warning-content"
              role="status"
            >
              Offline: {{ store.queue().length }} {{ store.queue().length === 1 ? 'result' : 'results' }} queued in this
              browser
            </div>
          }
          @switch (store.view().kind) {
            @case ('landing') {
              <pc-canvass-landing></pc-canvass-landing>
            }
            @case ('list') {
              <pc-canvass-list></pc-canvass-list>
            }
            @case ('map') {
              <pc-canvass-map></pc-canvass-map>
            }
            @case ('me') {
              <pc-canvass-me></pc-canvass-me>
            }
            @case ('household') {
              <pc-canvass-household></pc-canvass-household>
            }
            @case ('survey') {
              <pc-canvass-survey></pc-canvass-survey>
            }
          }
          @if (tabsVisible()) {
            <p class="mt-auto px-4 pb-3 pt-4 text-center text-xs text-base-content/40">Powered by pplCRM</p>
          }
        </div>

        @if (tabsVisible()) {
          <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100" aria-label="Sections">
            <div class="mx-auto grid max-w-md grid-cols-3">
              @for (tab of tabs; track tab.id) {
                <button
                  type="button"
                  class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium"
                  [class.text-primary]="activeTab() === tab.id"
                  [class.text-base-content]="activeTab() !== tab.id"
                  [class.opacity-60]="activeTab() !== tab.id"
                  [attr.aria-current]="activeTab() === tab.id ? 'page' : null"
                  (click)="openTab(tab.id)"
                >
                  <pc-icon [name]="tab.icon" [size]="5"></pc-icon>
                  {{ tab.label }}
                </button>
              }
            </div>
          </nav>
        }
      }
    </pc-companion-gate>
  `,
})
export class CanvassPage {
  /**
   * Route param from /t/:token. Absent on /canvass, where the device session identifies
   * the volunteer instead — the door a QR joiner comes through, since their turf link is
   * hashed and can never be handed back to them.
   */
  public readonly token = input<string | undefined>(undefined);

  protected readonly store = inject(CanvassStore);

  protected readonly tabs: { id: TabId; label: string; icon: PcIconNameType }[] = [
    { id: 'list', label: 'Turf', icon: 'queue-list' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'me', label: 'Me', icon: 'user-circle' },
  ];

  protected readonly activeTab = computed<TabId | null>(() => {
    const kind = this.store.view().kind;
    return kind === 'list' || kind === 'map' || kind === 'me' ? kind : null;
  });
  /** Hidden inside household + survey (linear doorstep flow) and on the landing cover. */
  protected readonly tabsVisible = computed(() => this.activeTab() !== null);

  constructor() {
    // A dead session (revoked/expired) sends the volunteer back through the gate.
    effect(() => {
      if (this.store.sessionExpired()) window.location.reload();
    });
  }

  protected onReady(): void {
    void this.open();
  }

  protected openPicker(): void {
    this.store.loadError.set(null);
    this.store.view.set({ kind: 'picker' });
  }

  protected openTab(tab: TabId): void {
    this.store.view.set({ kind: tab });
  }

  protected retry(): void {
    void this.open();
  }

  /** Link-first when there is a link, session-first otherwise. */
  private open(): Promise<void> {
    const token = this.token();
    return token ? this.store.load(token) : this.store.bootstrapFromSession();
  }
}
