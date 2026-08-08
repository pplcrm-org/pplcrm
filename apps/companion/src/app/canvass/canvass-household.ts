import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnDestroy } from '@angular/core';

import type { CompanionDoorOutcome, CompanionHousehold, CompanionPerson, CompanionYardSign } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import { doorStatus, doorStatusLabel, hasVoted, householdStance, personStance } from './canvass-derive';
import { CanvassStore } from './canvass-store';
import {
  initialsOf,
  lastVisitLabel,
  personResultLabel,
  stanceStyle,
  statusBadgeClass,
  supportLevelLabel,
  timeAgoLabel,
  type StanceStyle,
} from './canvass-ui';

/** How often the "… ago" line is recomputed while a door is open. */
const CLOCK_TICK_MS = 30_000;

/**
 * Household detail (spec §3.4): the doorstep screen. Person cards open the
 * survey; the dashed "This household" card covers the no-name conversation;
 * the bottom grid records door-level outcomes (tap the active one again to
 * clear it). A DNC door blocks recording but still counts toward the turf.
 *
 * Every person card leads with **where they stand** — a thumb and a word, from the survey
 * just logged or from the CRM's prior ID — because that is what decides how the next
 * thirty seconds go. A yard sign already owed and a ballot already cast sit beside it for
 * the same reason: both change the ask.
 */
@Component({
  selector: 'pc-canvass-household',
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
              Walk order {{ h.walk_order }} · {{ h.people.length }} {{ h.people.length === 1 ? 'person' : 'people' }} on
              file
            </p>
          </div>
        </header>

        <!-- Somebody already came here recently. Above everything else, because it can
             change whether this door is worth knocking at all. -->
        @if (lastVisit(h); as note) {
          <div class="flex items-center gap-2 rounded-lg bg-base-200 px-3 py-2 text-base-content/70">
            <pc-icon name="clock" [size]="4"></pc-icon>
            <p class="text-xs">{{ note }}</p>
          </div>
        }

        <!-- What this door is, in one line, before any of the actions. -->
        @if (doorStance(h); as s) {
          <div class="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-3" [class]="s.tone">
            <pc-icon [name]="s.icon" [size]="5"></pc-icon>
            <p class="text-sm font-medium">{{ s.label }}</p>
          </div>
        }

        <!-- The yard sign, and the one thing a canvasser carrying signs can do about it. -->
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

        <div class="flex flex-wrap gap-2">
          @if (voted(h)) {
            <span class="badge badge-success badge-outline gap-1">
              <pc-icon name="check-circle" [size]="4"></pc-icon>
              Already voted
            </span>
          }
        </div>

        @if (h.dnc) {
          <div
            class="flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 p-3 text-error"
            role="alert"
          >
            <pc-icon name="shield-exclamation" [size]="5"></pc-icon>
            <p class="text-sm font-medium">Skip this door. It still counts toward your turf.</p>
          </div>
        }

        <!-- The anonymous household-level conversation. -->
        <button
          type="button"
          class="w-full rounded-lg border p-4 text-left"
          [class.border-dashed]="!h.hh_survey"
          [class.border-primary]="!h.hh_survey"
          [class.border-base-300]="!!h.hh_survey"
          [class.bg-base-100]="!!h.hh_survey"
          [class.opacity-50]="h.dnc"
          [disabled]="h.dnc"
          (click)="openSurvey(null)"
        >
          <span class="font-medium" [class.text-primary]="!h.hh_survey">This household</span>
          @if (!h.hh_survey) {
            <span class="mt-1 block text-xs text-base-content/70">No name? Log the conversation for the door.</span>
          } @else {
            <span class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="badge badge-success">{{ hhSurveyLabel(h) }}</span>
              @for (issue of h.hh_survey.issues; track issue) {
                <span class="badge badge-ghost">{{ issue }}</span>
              }
              @for (chip of surveyChips(h.hh_survey); track chip.label) {
                <span [class]="chip.cls">{{ chip.label }}</span>
              }
            </span>
          }
        </button>

        <!-- People on file. -->
        <div class="flex flex-col gap-2">
          @for (p of h.people; track p.id) {
            <button
              type="button"
              class="flex w-full items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left"
              [class.opacity-50]="h.dnc || p.dnc"
              [disabled]="h.dnc || p.dnc"
              (click)="openSurvey(p.id)"
            >
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-semibold text-base-content/80"
              >
                {{ initials(p.name) }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="min-w-0 truncate font-medium" [class.line-through]="p.deceased">{{ p.name }}</span>
                  @if (stance(p); as s) {
                    <pc-icon [name]="s.icon" [size]="4" [class]="s.tone" [title]="s.label"></pc-icon>
                  }
                </span>
                <span class="mt-1 flex flex-wrap items-center gap-1.5">
                  @if (p.deceased) {
                    <span class="badge badge-neutral">Deceased</span>
                  } @else if (p.dnc) {
                    <span class="badge badge-error">Do not contact</span>
                  } @else if (p.result; as result) {
                    <span [class]="resultChipClass(result)">{{ resultLabel(p) }}</span>
                  } @else {
                    <span class="text-xs font-medium text-primary">Tap to survey</span>
                  }
                  <!-- The CRM's prior read, named as prior. Only when this walk hasn't
                       recorded its own answer — two stances on one card would compete. -->
                  @if (!p.survey && priorLabel(p); as prior) {
                    <span class="badge badge-ghost">{{ prior }} on file</span>
                  }
                  @if (p.senior) {
                    <span class="badge badge-ghost">65+</span>
                  }
                  @if (p.survey; as survey) {
                    @for (issue of survey.issues; track issue) {
                      <span class="badge badge-ghost">{{ issue }}</span>
                    }
                    @for (chip of surveyChips(survey); track chip.label) {
                      <span [class]="chip.cls">{{ chip.label }}</span>
                    }
                  }
                </span>
              </span>
            </button>
          }
        </div>

        @if (!h.dnc) {
          <!-- Add someone met at the door — inline, no modal. -->
          @if (!adding()) {
            <button type="button" class="btn btn-outline btn-primary w-full border-dashed" (click)="adding.set(true)">
              + Add someone at this door
            </button>
          } @else {
            <form class="flex gap-2" (submit)="addPerson($event)">
              <input
                class="input input-bordered min-h-11 flex-1"
                type="text"
                placeholder="Their name"
                aria-label="Name of the person at this door"
                [value]="newName()"
                (input)="onNameInput($event)"
              />
              <button type="submit" class="btn btn-primary" [disabled]="!newName().trim()">
                {{ newName().trim() ? 'Add' : 'Enter a name' }}
              </button>
              <button type="button" class="btn btn-ghost btn-circle" aria-label="Cancel adding" (click)="cancelAdd()">
                <pc-icon name="x-mark" [size]="5"></pc-icon>
              </button>
            </form>
          }

          <!-- Door-level outcomes. -->
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
export class CanvassHousehold implements OnDestroy {
  private readonly alerts = inject(AlertService);
  protected readonly store = inject(CanvassStore);

  protected readonly adding = signal(false);
  protected readonly newName = signal('');

  /**
   * Ticks so "12 minutes ago" is still true after the volunteer has stood at the door for
   * a while. The walk list's 60s refresh is unmounted on this screen, so nothing else
   * would move the clock forward.
   */
  private readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);

  /**
   * Four door codes, in escalating finality: nobody answered, we couldn't get to the door,
   * they turned us away, nobody lives here. "Moved out" is the one that changes the file
   * rather than the visit, which is why it is worth its own button rather than a note.
   */
  protected readonly outcomeOptions: { outcome: CompanionDoorOutcome; label: string; toast: string }[] = [
    { outcome: 'no_answer', label: 'Nobody home', toast: 'Marked "Nobody home"' },
    { outcome: 'inaccessible', label: 'Inaccessible', toast: 'Marked "Inaccessible"' },
    { outcome: 'refused', label: 'Refused', toast: 'Marked "Refused"' },
    { outcome: 'moved', label: 'Moved out', toast: 'Marked "Moved out"' },
  ];

  protected readonly household = computed<CompanionHousehold | null>(() => {
    const view = this.store.view();
    return view.kind === 'household' ? this.store.householdById(view.household_id) : null;
  });

  protected addPerson(event: Event): void {
    event.preventDefault();
    const h = this.household();
    const name = this.newName().trim();
    if (!h || !name) return;
    this.store.addPerson(h.id, name);
    this.alerts.showSuccess('Added. Will be created in pplCRM');
    this.cancelAdd();
  }

  /** Back to the building's unit list when this door is a flat, otherwise the walk list. */
  protected back(): void {
    const h = this.household();
    const buildingKey = h ? this.buildingKeyFor(h) : null;
    if (buildingKey) this.store.view.set({ kind: 'building', building_key: buildingKey });
    else this.store.view.set({ kind: 'list' });
  }

  protected cancelAdd(): void {
    this.adding.set(false);
    this.newName.set('');
  }

  protected chipClass(h: CompanionHousehold): string {
    return statusBadgeClass(doorStatus(h));
  }

  protected chipLabel(h: CompanionHousehold): string {
    return doorStatusLabel(doorStatus(h));
  }

  protected doorStance(h: CompanionHousehold): StanceStyle | null {
    return stanceStyle(householdStance(h));
  }

  protected hhSurveyLabel(h: CompanionHousehold): string {
    return personResultLabel('canvassed', h.hh_survey?.support ?? null);
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  /** "Yard sign requested 4 days ago" — the wait is the reason to hand one over now. */
  protected signRequestedLabel(sign: CompanionYardSign): string {
    const at = sign.requested_at == null ? Number.NaN : Date.parse(sign.requested_at);
    if (Number.isNaN(at)) return 'Yard sign requested';
    return `Yard sign requested ${timeAgoLabel(Math.max(0, this.now() - at))}`;
  }

  protected deliverSign(h: CompanionHousehold): void {
    if (this.store.yardSign(h.id, true)) this.alerts.showSuccess('Sign marked delivered');
  }

  protected undoSign(h: CompanionHousehold): void {
    if (this.store.yardSign(h.id, false)) this.alerts.showSuccess('Delivery undone. The sign is owed again');
  }

  /** "Julie L. spoke to someone here 1 day ago", or null when nobody has been recently. */
  protected lastVisit(h: CompanionHousehold): string | null {
    return lastVisitLabel(h.last_knock, {
      myName: this.store.payload()?.canvasser_name ?? null,
      now: this.now(),
    });
  }

  public ngOnDestroy(): void {
    clearInterval(this.clock);
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

  protected onNameInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.newName.set(target.value);
  }

  protected openSurvey(personId: string | null): void {
    const h = this.household();
    if (!h || h.dnc) return;
    this.store.view.set({ kind: 'survey', household_id: h.id, person_id: personId });
  }

  protected priorLabel(p: CompanionPerson): string | null {
    return supportLevelLabel(p.support);
  }

  protected resultChipClass(result: CompanionPerson['result']): string {
    if (result === 'canvassed') return 'badge badge-success';
    if (result === 'refused') return 'badge badge-error';
    if (result === 'data_error') return 'badge badge-neutral';
    return 'badge badge-warning';
  }

  protected resultLabel(p: CompanionPerson): string {
    return p.result == null ? '' : personResultLabel(p.result, p.survey?.support ?? null);
  }

  protected stance(p: CompanionPerson): StanceStyle | null {
    return stanceStyle(personStance(p));
  }

  /** Follow-up toggle chips shown on a surveyed card. */
  protected surveyChips(survey: {
    wants_volunteer: boolean;
    wants_yard_sign: boolean;
    set_dnc: boolean;
    subscribe: boolean;
  }): { label: string; cls: string }[] {
    const chips: { label: string; cls: string }[] = [];
    if (survey.wants_volunteer) chips.push({ label: 'Wants to volunteer', cls: 'badge badge-info badge-outline' });
    if (survey.wants_yard_sign) chips.push({ label: 'Yard sign', cls: 'badge badge-info badge-outline' });
    if (survey.subscribe) chips.push({ label: 'Subscribed', cls: 'badge badge-info badge-outline' });
    if (survey.set_dnc) chips.push({ label: 'Do not contact', cls: 'badge badge-error' });
    return chips;
  }

  protected voted(h: CompanionHousehold): boolean {
    return hasVoted(h);
  }

  /** Which building this door belongs to, if it renders as one on the walk list. */
  private buildingKeyFor(h: CompanionHousehold): string | null {
    return (
      this.store.walkEntries().find((e) => e.kind === 'building' && e.units.some((u) => u.id === h.id))?.key ?? null
    );
  }
}
