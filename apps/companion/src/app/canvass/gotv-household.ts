import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnDestroy } from '@angular/core';

import type { CompanionDoorOutcome, CompanionHousehold, CompanionPerson, CompanionYardSign } from '@common';
import { VOTED_STATUSES } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import { doorStatus, doorStatusLabel, livingResidents } from './canvass-derive';
import { CanvassStore } from './canvass-store';
import {
  initialsOf,
  lastVisitLabel,
  navigateUrl,
  personResultLabel,
  statusBadgeClass,
  supportLevelLabel,
  timeAgoLabel,
} from './canvass-ui';

/** How often the "… ago" line is recomputed while a door is open. */
const CLOCK_TICK_MS = 30_000;

/**
 * GOTV doorstep screen (turfs with mode 'gotv'): remind identified supporters to vote.
 *
 * A sibling of the canvass household screen rather than branches inside it — the two
 * doors do different jobs. Here the visit is two taps per person: **Reminded** (stored as
 * the ordinary supporter survey — "spoke, will vote") or **Already voted** (stored as the
 * already_voted survey, which writes the person's voting status so the green check
 * renders everywhere). No new vocabulary reaches the server from this screen.
 *
 * What stays from the canvass door, because losing it would lose real work: the
 * last-visit line, the yard-sign handover, the DNC skip, the door-level outcomes, and a
 * "Full survey" path for the door that turns into a real conversation. Navigate is here
 * too — a GOTV walk skips most doors, so the next one is rarely next door.
 */
@Component({
  selector: 'pc-gotv-household',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (household(); as h) {
      <div class="flex flex-1 flex-col gap-4 p-4">
        <header class="flex items-start gap-2">
          <button type="button" class="btn btn-ghost btn-circle" aria-label="Back" (click)="back()">
            <pc-icon name="chevron-left" [size]="5"></pc-icon>
          </button>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-lg font-bold">{{ h.address }}</h1>
              <span [class]="chipClass(h)">{{ chipLabel(h) }}</span>
            </div>
            <p class="text-xs text-base-content/70">
              {{ h.people.length }} {{ h.people.length === 1 ? 'person' : 'people' }} on file
            </p>
          </div>
          <button
            type="button"
            class="btn btn-outline btn-primary btn-sm"
            [attr.aria-label]="'Navigate to ' + h.address"
            (click)="navigate(h)"
          >
            <pc-icon name="map-pin" [size]="4"></pc-icon>
            Navigate
          </button>
        </header>

        <!-- Somebody already came here recently. Above everything else, because it can
             change whether this door is worth knocking at all. -->
        @if (lastVisit(h); as note) {
          <div class="flex items-center gap-2 rounded-lg bg-base-200 px-3 py-2 text-base-content/70">
            <pc-icon name="clock" [size]="4"></pc-icon>
            <p class="text-xs">{{ note }}</p>
          </div>
        }

        @if (h.dnc) {
          <div
            class="flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 p-3 text-error"
            role="alert"
          >
            <pc-icon name="shield-exclamation" [size]="5"></pc-icon>
            <p class="text-sm font-medium">Skip this door. It still counts toward your turf.</p>
          </div>
        }

        <!-- The yard sign, and the one thing a volunteer carrying signs can do about it. -->
        @if (h.yard_sign; as sign) {
          @if (sign.status === 'delivered') {
            <div class="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
              <pc-icon name="yard-sign" [size]="5" class="text-success"></pc-icon>
              <p class="flex-1 text-sm font-medium text-success">Sign delivered</p>
              <button type="button" class="btn btn-ghost btn-xs" [disabled]="h.dnc" (click)="undoSign(h)">Undo</button>
            </div>
          } @else {
            <div class="flex flex-col gap-2 rounded-lg border border-info/30 bg-info/10 p-3">
              <div class="flex items-center gap-2">
                <pc-icon name="yard-sign" [size]="5" class="text-info"></pc-icon>
                <p class="text-sm font-medium text-info">{{ signRequestedLabel(sign) }}</p>
              </div>
              <button type="button" class="btn btn-info btn-sm min-h-11" [disabled]="h.dnc" (click)="deliverSign(h)">
                I delivered the sign
              </button>
            </div>
          }
        }

        <!-- One card per person: who, where they stood, and the two GOTV taps. -->
        <div class="flex flex-col gap-2">
          @for (p of people(h); track p.id) {
            <div class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
              <div class="flex items-start gap-3">
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-semibold text-base-content/80"
                >
                  {{ initials(p.name) }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ p.name }}</span>
                  <span class="mt-1 flex flex-wrap items-center gap-1.5">
                    @if (p.dnc) {
                      <span class="badge badge-error">Do not contact</span>
                    }
                    @if (hasVotedAlready(p)) {
                      <span class="badge badge-success gap-1">
                        <pc-icon name="check-circle" [size]="4"></pc-icon>
                        Voted
                      </span>
                    }
                    @if (p.result; as result) {
                      <span class="badge badge-success">{{ resultLabel(p) }}</span>
                    } @else if (priorLabel(p); as prior) {
                      <span class="badge badge-ghost">{{ prior }} on file</span>
                    }
                  </span>
                </span>
              </div>
              @if (!h.dnc && !p.dnc && p.result == null && !hasVotedAlready(p)) {
                <div class="grid grid-cols-2 gap-2">
                  <button type="button" class="btn btn-primary btn-sm min-h-11" (click)="reminded(h, p)">
                    Reminded
                  </button>
                  <button type="button" class="btn btn-outline btn-primary btn-sm min-h-11" (click)="voted(h, p)">
                    Already voted
                  </button>
                </div>
              }
            </div>
          }
        </div>

        @if (!h.dnc) {
          <!-- The door that turns into a real conversation: the full survey, unchanged. -->
          <button type="button" class="btn btn-outline btn-primary w-full border-dashed" (click)="openSurvey(h)">
            Full survey instead
          </button>

          <!-- Door-level outcomes. Two, not four: a GOTV volunteer either found nobody or
               found the supporter gone — "inaccessible" and "refused" belong to the
               persuasion walk's fuller grid, one tap away behind "Full survey". -->
          <div class="mt-auto flex flex-col gap-2 pt-2">
            <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
              No conversation at this door?
            </p>
            <div class="grid grid-cols-2 gap-2">
              @for (option of outcomeOptions; track option.outcome) {
                <button
                  type="button"
                  class="btn"
                  [class.btn-warning]="h.door_outcome === option.outcome"
                  [class.btn-outline]="h.door_outcome !== option.outcome"
                  [class.btn-secondary]="h.door_outcome !== option.outcome"
                  [attr.aria-pressed]="h.door_outcome === option.outcome"
                  (click)="mark(option.outcome)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
            <p class="text-xs text-base-content/60">"Moved out" means nobody on this list lives here anymore.</p>
          </div>
        }
      </div>
    } @else {
      <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-base-content/70">This door isn't in your turf anymore.</p>
        <button type="button" class="btn btn-primary" (click)="back()">Back to the walk list</button>
      </div>
    }
  `,
})
export class GotvHousehold implements OnDestroy {
  private readonly alerts = inject(AlertService);
  protected readonly store = inject(CanvassStore);

  /** Ticks so the last-visit and sign-wait lines stay true while the door is open. */
  private readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);

  protected readonly outcomeOptions: { outcome: CompanionDoorOutcome; label: string; toast: string }[] = [
    { outcome: 'no_answer', label: 'Nobody home', toast: 'Marked "Nobody home"' },
    { outcome: 'moved', label: 'Moved out', toast: 'Marked "Moved out"' },
  ];

  protected readonly household = computed<CompanionHousehold | null>(() => {
    const view = this.store.view();
    return view.kind === 'household' ? this.store.householdById(view.household_id) : null;
  });

  protected back(): void {
    this.store.view.set({ kind: 'list' });
  }

  protected chipClass(h: CompanionHousehold): string {
    return statusBadgeClass(doorStatus(h));
  }

  protected chipLabel(h: CompanionHousehold): string {
    return doorStatusLabel(doorStatus(h));
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  /** GOTV never reads a dead person's name off a screen at their family's door. */
  protected people(h: CompanionHousehold): CompanionPerson[] {
    return livingResidents(h);
  }

  protected hasVotedAlready(p: CompanionPerson): boolean {
    return p.voting_status != null && VOTED_STATUSES.includes(p.voting_status);
  }

  protected priorLabel(p: CompanionPerson): string | null {
    return supportLevelLabel(p.support);
  }

  protected resultLabel(p: CompanionPerson): string {
    return p.result == null ? '' : personResultLabel(p.result, p.survey?.support ?? null);
  }

  protected reminded(h: CompanionHousehold, p: CompanionPerson): void {
    this.store.quickSurvey(h.id, p.id, 'supporter');
    this.alerts.showSuccess(`Reminded ${p.name} to vote`);
  }

  protected voted(h: CompanionHousehold, p: CompanionPerson): void {
    this.store.quickSurvey(h.id, p.id, 'already_voted');
    this.alerts.showSuccess(`Marked ${p.name} "Already voted"`);
  }

  protected mark(outcome: CompanionDoorOutcome): void {
    const h = this.household();
    if (!h) return;
    const result = this.store.doorOutcome(h.id, outcome);
    if (result === 'set') {
      const option = this.outcomeOptions.find((o) => o.outcome === outcome);
      this.alerts.showSuccess(option?.toast ?? 'Marked');
      this.back();
    } else {
      this.alerts.showSuccess('Cleared. Door is back on your list');
    }
  }

  /** The anonymous full survey — for the door where the conversation went past a reminder. */
  protected openSurvey(h: CompanionHousehold): void {
    if (h.dnc) return;
    this.store.view.set({ kind: 'survey', household_id: h.id, person_id: null });
  }

  protected navigate(h: CompanionHousehold): void {
    window.open(navigateUrl(h), '_blank', 'noopener');
  }

  protected deliverSign(h: CompanionHousehold): void {
    if (this.store.yardSign(h.id, true)) this.alerts.showSuccess('Sign marked delivered');
  }

  protected undoSign(h: CompanionHousehold): void {
    if (this.store.yardSign(h.id, false)) this.alerts.showSuccess('Delivery undone. The sign is owed again');
  }

  /** "Yard sign requested 4 days ago" — the wait is the reason to hand one over now. */
  protected signRequestedLabel(sign: CompanionYardSign): string {
    const at = sign.requested_at == null ? Number.NaN : Date.parse(sign.requested_at);
    if (Number.isNaN(at)) return 'Yard sign requested';
    return `Yard sign requested ${timeAgoLabel(Math.max(0, this.now() - at))}`;
  }

  protected lastVisit(h: CompanionHousehold): string | null {
    return lastVisitLabel(h.last_knock, {
      myName: this.store.payload()?.canvasser_name ?? null,
      now: this.now(),
    });
  }

  public ngOnDestroy(): void {
    clearInterval(this.clock);
  }
}
