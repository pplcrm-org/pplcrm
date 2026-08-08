import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { CompanionPerson, KnockResponse } from '@common';
import { KNOCK_RESPONSES, KNOCK_RESPONSE_LABELS } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import { CanvassStore } from './canvass-store';
import { supportLevelLabel } from './canvass-ui';

const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;

/** No-conversation codes and the record corrections, kept apart on purpose — see below. */
type QuickCode = 'not_home' | 'moved' | 'refused';

/**
 * The survey (spec §3.5) for one person — or the anonymous household-level
 * conversation when the view carries no person. No-conversation codes come
 * first (one tap and out); support level is the one required field, except
 * that a DNC-only or seniors-only save is allowed. Pre-fills from the previous
 * survey when re-opened.
 *
 * **Corrections to the file live at the bottom, behind a confirmation.** "Deceased" and
 * "Error in data" are not reports of a visit — they change the record for everyone, and
 * deceased additionally stops all contact. Putting them in the top row alongside "Not
 * home" would put a permanent action one mis-tap away from the most-tapped button on the
 * screen; putting them at the end, with the name spelled out in the confirmation, costs a
 * canvasser two seconds on the rare occasion they need them.
 */
@Component({
  selector: 'pc-canvass-survey',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="flex flex-1 flex-col gap-4 p-4">
      <header class="flex items-start gap-2">
        <button type="button" class="btn btn-ghost btn-circle" aria-label="Back to the household" (click)="back()">
          <pc-icon name="chevron-left" [size]="5"></pc-icon>
        </button>
        <div class="min-w-0 flex-1">
          <h1 class="text-lg font-bold">{{ title() }}</h1>
          <p class="text-xs text-base-content/70">{{ address() }}</p>
          @if (priorLabel(); as prior) {
            <p class="text-xs text-base-content/70">On file: {{ prior }}</p>
          }
        </div>
      </header>

      @if (isPerson()) {
        <div class="flex flex-col gap-2">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">No conversation?</p>
          <div class="grid grid-cols-3 gap-2">
            @for (option of quickCodes; track option.result) {
              <button type="button" class="btn btn-outline btn-primary" (click)="recordNoConversation(option.result)">
                {{ option.label }}
              </button>
            }
          </div>
        </div>
      }

      @if (script(); as script) {
        <div class="collapse-arrow collapse border border-base-300 bg-base-200/50">
          <input type="checkbox" aria-label="Show or hide the door script" />
          <div class="collapse-title font-medium">Door script</div>
          <div class="collapse-content text-base-content/80">
            <p class="whitespace-pre-wrap">{{ script }}</p>
          </div>
        </div>
      }

      <div class="flex flex-col gap-2" role="radiogroup" aria-label="Support level">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Support level</p>
        @for (response of responses; track response) {
          <button
            type="button"
            role="radio"
            class="btn justify-start"
            [class.btn-primary]="support() === response"
            [class.btn-outline]="support() !== response"
            [class.btn-secondary]="support() !== response"
            [attr.aria-checked]="support() === response"
            (click)="pickSupport(response)"
          >
            {{ responseLabels[response] }}
          </button>
        }
      </div>

      @if (issueOptions().length > 0) {
        <div class="flex flex-col gap-2">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Issues they raised</p>
          <div class="flex flex-wrap gap-2">
            @for (issue of issueOptions(); track issue) {
              <button
                type="button"
                class="btn rounded-full"
                [class.btn-primary]="issues().includes(issue)"
                [class.btn-outline]="!issues().includes(issue)"
                [class.btn-secondary]="!issues().includes(issue)"
                [attr.aria-pressed]="issues().includes(issue)"
                (click)="toggleIssue(issue)"
              >
                {{ issue }}
              </button>
            }
          </div>
        </div>
      }

      <div class="flex flex-col gap-1 rounded-lg border border-base-300 bg-base-100 p-3">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Follow-ups</p>
        @if (isPerson()) {
          <label class="flex min-h-11 items-center justify-between gap-3">
            <span>Wants to volunteer</span>
            <input
              type="checkbox"
              class="toggle toggle-primary"
              [checked]="wantsVolunteer()"
              (change)="onToggle('volunteer', $event)"
            />
          </label>
        }
        <label class="flex min-h-11 items-center justify-between gap-3">
          <span>
            Wants a yard sign
            <span class="block text-xs text-base-content/60">Adds them to the sign delivery list</span>
          </span>
          <input
            type="checkbox"
            class="toggle toggle-primary"
            [checked]="wantsYardSign()"
            (change)="onToggle('yard_sign', $event)"
          />
        </label>
        <!-- A canvasser with signs in the car asks and hands one over in the same half
             minute. Nested under the ask because it has no meaning without it, and hidden
             once the door already has its sign so it can never claim a second delivery. -->
        @if (wantsYardSign() && !signAlreadyDelivered()) {
          <label class="flex min-h-11 items-center justify-between gap-3 pl-4">
            <span>
              I gave them one just now
              <span class="block text-xs text-base-content/60">Marks the sign delivered — no driver needed</span>
            </span>
            <input
              type="checkbox"
              class="toggle toggle-primary"
              [checked]="yardSignDelivered()"
              (change)="onToggle('yard_sign_delivered', $event)"
            />
          </label>
        }
        @if (isPerson()) {
          <label class="flex min-h-11 items-center justify-between gap-3">
            <span>
              65 or older
              <span class="block text-xs text-base-content/60">Only set this if they said so</span>
            </span>
            <input
              type="checkbox"
              class="toggle toggle-primary"
              [checked]="senior()"
              (change)="onToggle('senior', $event)"
            />
          </label>
        }
        <label class="flex min-h-11 items-center justify-between gap-3 text-error">
          <span>
            Do not contact
            <span class="block text-xs text-base-content/60">Stops every letter, email and call</span>
          </span>
          <input type="checkbox" class="toggle toggle-error" [checked]="setDnc()" (change)="onToggle('dnc', $event)" />
        </label>
      </div>

      @if (isPerson()) {
        <div class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Contact info</p>
          <input
            type="tel"
            class="input input-bordered min-h-11 w-full"
            placeholder="Phone"
            aria-label="Phone"
            [value]="phone()"
            (input)="onText('phone', $event)"
          />
          <input
            type="email"
            class="input input-bordered min-h-11 w-full"
            placeholder="Email"
            aria-label="Email"
            [value]="email()"
            (input)="onText('email', $event)"
          />
          @if (email().trim() && !emailValid()) {
            <p class="text-xs text-error" role="alert">That email doesn't look complete.</p>
          }
          <label class="flex min-h-11 items-center justify-between gap-3" [class.opacity-60]="!canSubscribe()">
            <span>
              Subscribe to updates
              @if (!canSubscribe()) {
                <span class="block text-xs text-base-content/60">Add a phone or email to subscribe</span>
              }
            </span>
            <input
              type="checkbox"
              class="toggle toggle-primary"
              [checked]="subscribe() && canSubscribe()"
              [disabled]="!canSubscribe()"
              (change)="onToggle('subscribe', $event)"
            />
          </label>
        </div>
      }

      <textarea
        class="textarea textarea-bordered min-h-24 w-full"
        placeholder="Anything the organizer should know?"
        aria-label="Notes for the organizer"
        [value]="notes()"
        (input)="onText('notes', $event)"
      ></textarea>

      <button type="button" class="btn btn-primary w-full" [disabled]="saveBlocker() !== null" (click)="save()">
        {{ saveBlocker() ?? 'Save & sync' }}
      </button>

      @if (isPerson()) {
        <!-- Record corrections. Last, quiet, and confirmed — these change the file for
             everyone, not just what happened at this door today. -->
        <div class="flex flex-col gap-2 rounded-lg border border-base-300 p-3">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
            Something wrong with this record?
          </p>

          @if (correction() === null) {
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="btn btn-ghost btn-sm" (click)="correction.set('deceased')">Deceased</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="correction.set('data_error')">
                Error in data
              </button>
            </div>
          } @else if (correction() === 'deceased') {
            <p class="text-sm">
              Mark <span class="font-medium">{{ title() }}</span> as deceased? This stops every letter, email and call
              to them, right away.
            </p>
            <div class="flex gap-2">
              <button type="button" class="btn btn-error btn-sm flex-1" (click)="confirmDeceased()">
                Yes, mark deceased
              </button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="cancelCorrection()">Cancel</button>
            </div>
          } @else {
            <p class="text-sm">What's wrong? An organizer will look at the record and fix it.</p>
            <textarea
              class="textarea textarea-bordered min-h-20 w-full"
              placeholder="Wrong name, wrong unit, nobody by this name here…"
              aria-label="What is wrong with this record"
              [value]="errorNote()"
              (input)="onText('error', $event)"
            ></textarea>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-sm flex-1"
                [disabled]="!errorNote().trim()"
                (click)="confirmDataError()"
              >
                {{ errorNote().trim() ? 'Send to the organizer' : 'Say what is wrong' }}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="cancelCorrection()">Cancel</button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class CanvassSurvey {
  private readonly alerts = inject(AlertService);
  protected readonly store = inject(CanvassStore);

  protected readonly responses: readonly KnockResponse[] = KNOCK_RESPONSES;
  protected readonly responseLabels = KNOCK_RESPONSE_LABELS;
  protected readonly quickCodes: { result: QuickCode; label: string }[] = [
    { result: 'not_home', label: 'Not home' },
    { result: 'moved', label: 'Moved' },
    { result: 'refused', label: 'Refused' },
  ];

  // Draft state — seeded once from the existing survey prefill (if any).
  protected readonly support = signal<KnockResponse | null>(null);
  protected readonly issues = signal<string[]>([]);
  protected readonly wantsVolunteer = signal(false);
  protected readonly wantsYardSign = signal(false);
  protected readonly yardSignDelivered = signal(false);
  protected readonly setDnc = signal(false);
  protected readonly senior = signal(false);
  protected readonly phone = signal('');
  protected readonly email = signal('');
  protected readonly subscribe = signal(false);
  protected readonly notes = signal('');
  /** Which record correction is open, if any. Null = the two buttons. */
  protected readonly correction = signal<'deceased' | 'data_error' | null>(null);
  protected readonly errorNote = signal('');

  protected readonly householdId = computed(() => {
    const view = this.store.view();
    return view.kind === 'survey' ? view.household_id : null;
  });
  protected readonly personId = computed(() => {
    const view = this.store.view();
    return view.kind === 'survey' ? view.person_id : null;
  });
  protected readonly isPerson = computed(() => this.personId() != null);
  protected readonly person = computed<CompanionPerson | null>(() => {
    const householdId = this.householdId();
    const personId = this.personId();
    if (householdId == null || personId == null) return null;
    return this.store.householdById(householdId)?.people.find((p) => p.id === personId) ?? null;
  });

  protected readonly address = computed(() => {
    const householdId = this.householdId();
    return householdId != null ? (this.store.householdById(householdId)?.address ?? '') : '';
  });
  /**
   * This door already has its sign. Hides the hand-over line rather than disabling it: a
   * canvasser who reads "I gave them one just now" on a door that already has a sign is
   * being invited to record a delivery that cannot happen twice.
   */
  protected readonly signAlreadyDelivered = computed(() => {
    const householdId = this.householdId();
    if (householdId == null) return false;
    return this.store.householdById(householdId)?.yard_sign?.status === 'delivered';
  });
  protected readonly title = computed(() => this.person()?.name ?? 'This household');
  protected readonly script = computed(() => this.store.payload()?.script?.trim() ?? '');
  protected readonly issueOptions = computed(() => this.store.payload()?.issues ?? []);

  protected readonly emailValid = computed(() => {
    const email = this.email().trim();
    return email === '' || EMAIL_SHAPE.test(email);
  });
  protected readonly canSubscribe = computed(() => this.phone().trim() !== '' || this.email().trim() !== '');

  /** Why the save is blocked — or null when it can go. Explained-disabled (§3). */
  protected readonly saveBlocker = computed<string | null>(() => {
    if (!this.emailValid()) return 'Fix the email to save';
    if (this.support() == null && !this.setDnc() && !this.senior()) return 'Pick a support level to save';
    return null;
  });

  constructor() {
    // Pre-fill from the earlier survey when re-opening (notes and contact info
    // are deliberately never echoed back — payload minimization, spec §2).
    const view = this.store.view();
    if (view.kind !== 'survey') return;
    const household = this.store.householdById(view.household_id);
    const person = view.person_id == null ? null : household?.people.find((p) => p.id === view.person_id);
    // Age comes off the PERSON, not off a knock: it is a fact about them that any earlier
    // canvasser may have recorded, and pre-filling it is what makes un-ticking it a
    // correction rather than a blanket "not a senior" claim about the whole turf.
    this.senior.set(person?.senior === true);
    const prefill = view.person_id == null ? household?.hh_survey : person?.survey;
    if (!prefill) return;
    this.support.set(prefill.support);
    this.issues.set([...prefill.issues]);
    this.wantsVolunteer.set(prefill.wants_volunteer);
    this.wantsYardSign.set(prefill.wants_yard_sign);
    this.setDnc.set(prefill.set_dnc);
    this.subscribe.set(prefill.subscribe);
  }

  protected back(): void {
    const householdId = this.householdId();
    if (householdId != null) this.store.view.set({ kind: 'household', household_id: householdId });
    else this.store.view.set({ kind: 'list' });
  }

  protected cancelCorrection(): void {
    this.correction.set(null);
    this.errorNote.set('');
  }

  protected confirmDataError(): void {
    const householdId = this.householdId();
    const personId = this.personId();
    const note = this.errorNote().trim();
    if (householdId == null || personId == null || !note) return;
    this.store.personResult(householdId, personId, 'data_error', note);
    this.alerts.showSuccess('Sent. An organizer will check this record');
    this.cancelCorrection();
    this.back();
  }

  protected confirmDeceased(): void {
    const householdId = this.householdId();
    const personId = this.personId();
    if (householdId == null || personId == null) return;
    this.store.personResult(householdId, personId, 'deceased');
    this.alerts.showSuccess('Recorded. They will not be contacted again');
    this.cancelCorrection();
    this.back();
  }

  protected onText(field: 'phone' | 'email' | 'notes' | 'error', event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
    if (field === 'phone') this.phone.set(target.value);
    else if (field === 'email') this.email.set(target.value);
    else if (field === 'error') this.errorNote.set(target.value);
    else this.notes.set(target.value);
  }

  protected onToggle(
    field: 'volunteer' | 'yard_sign' | 'yard_sign_delivered' | 'dnc' | 'senior' | 'subscribe',
    event: Event,
  ): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const checked = target.checked;
    switch (field) {
      case 'volunteer':
        this.wantsVolunteer.set(checked);
        break;
      case 'yard_sign':
        this.wantsYardSign.set(checked);
        // Untick the ask and the hand-over goes with it — a delivery of a sign nobody
        // wants is not a thing that can have happened.
        if (!checked) this.yardSignDelivered.set(false);
        break;
      case 'yard_sign_delivered':
        this.yardSignDelivered.set(checked);
        break;
      case 'dnc':
        this.setDnc.set(checked);
        break;
      case 'senior':
        this.senior.set(checked);
        break;
      case 'subscribe':
        this.subscribe.set(checked);
        break;
      default: {
        const _exhaustive: never = field;
        void _exhaustive;
      }
    }
  }

  /** Tap the selected level again to unpick it (a DNC-only save stays possible). */
  protected pickSupport(response: KnockResponse): void {
    this.support.set(this.support() === response ? null : response);
  }

  /** What the CRM held coming in — shown only until this walk records its own answer. */
  protected priorLabel(): string | null {
    const person = this.person();
    if (!person || person.survey) return null;
    return supportLevelLabel(person.support);
  }

  protected recordNoConversation(result: QuickCode): void {
    const householdId = this.householdId();
    const personId = this.personId();
    if (householdId == null || personId == null) return;
    this.store.personResult(householdId, personId, result);
    const option = this.quickCodes.find((o) => o.result === result);
    this.alerts.showSuccess(`Marked "${option?.label ?? result}"`);
    this.back();
  }

  protected save(): void {
    const householdId = this.householdId();
    if (householdId == null || this.saveBlocker() != null) return;
    const isPerson = this.isPerson();
    this.store.submitSurvey(householdId, this.personId(), {
      support: this.support(),
      issues: this.issues(),
      wants_volunteer: isPerson ? this.wantsVolunteer() : false,
      wants_yard_sign: this.wantsYardSign(),
      yard_sign_delivered: this.yardSignDelivered(),
      set_dnc: this.setDnc(),
      senior: isPerson ? this.senior() : false,
      contact_phone: isPerson && this.phone().trim() ? this.phone().trim() : null,
      contact_email: isPerson && this.email().trim() ? this.email().trim() : null,
      subscribe: isPerson && this.canSubscribe() ? this.subscribe() : false,
      notes: this.notes().trim() ? this.notes().trim() : null,
    });
    const syncing = this.store.online() && !this.store.workOffline();
    this.alerts.showSuccess(syncing ? 'Saved · syncing to pplCRM…' : 'Saved. Will sync when back online');
    this.back();
  }

  protected toggleIssue(issue: string): void {
    this.issues.update((current) =>
      current.includes(issue) ? current.filter((i) => i !== issue) : [...current, issue],
    );
  }
}
