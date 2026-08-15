import { Service, computed, inject, signal } from '@angular/core';

import { AuthService } from '../../auth/auth-service';
import { TRPCService } from '../../services/api/trpc-service';
import { PersonsService } from '../persons/services/persons-service';
import { SettingsService } from '../settings/services/settings-service';

export type GoLiveStepId = 'demo' | 'plan' | 'organization' | 'phone' | 'sending' | 'people' | 'team';

/** Persisted wizard progress. Per TENANT: a workspace is configured once, by whoever gets there
 * first. (The product tour is the mirror image — per user, because each person learns once.) */
export interface GoLiveState {
  /** Where to resume. */
  step: GoLiveStepId;
  /** Answer to "will you send email from pplCRM?" — null until asked. */
  sendsEmail: boolean | null;
  /** Steps the user explicitly put off. They survive as checklist items rather than vanishing. */
  deferred: GoLiveStepId[];
  completedAt: string | null;
}

export const GO_LIVE_SETTINGS_KEY = 'setup.wizard';

const DEFAULT_STATE: GoLiveState = { step: 'demo', sendsEmail: null, deferred: [], completedAt: null };

/**
 * Drives the go-live wizard.
 *
 * Completion is DERIVED from real account state, never from a stored "done" flag — the same
 * approach the dashboard checklist already takes. A stored flag drifts the moment someone changes
 * something in Settings, and a wizard that claims a step is finished when it isn't is worse than
 * no wizard: it sends the user away believing they can send email.
 *
 * Only the things that cannot be derived are persisted: where to resume, the answer to the
 * branch question, and what was deliberately deferred.
 */
@Service()
export class GoLiveService extends TRPCService<any> {
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  private readonly persons = inject(PersonsService);

  private readonly snapshot = this.settings.snapshotSignal;
  private readonly user = this.auth.getUserSignal();

  private readonly _state = signal<GoLiveState>(DEFAULT_STATE);
  public readonly state = this._state.asReadonly();

  /** Live counts that can't be read from the settings snapshot. */
  private readonly _contactCount = signal<number | null>(null);
  private readonly _phoneVerified = signal(false);
  private readonly _hasPlan = signal(false);

  public readonly contactCount = this._contactCount.asReadonly();

  /** A plan is settled once billing reports an active subscription — free or paid. */
  public readonly planDone = computed(() => this._hasPlan());

  /** The postal address is the load-bearing one: the send guard blocks every newsletter without
   * it, because the compliance footer needs it. */
  public readonly organizationDone = computed(() => {
    const name = this.settings.getValue<string>('organization.name', '') ?? '';
    const address = this.settings.getValue<string>('organization.address', '') ?? '';
    return name.trim().length > 0 && address.trim().length > 0;
  });

  public readonly phoneDone = computed(() => this._phoneVerified());

  /** Sending counts as settled either by configuring it or by saying "not yet" out loud. */
  public readonly sendingDone = computed(() => {
    if (this._state().sendsEmail === false) return true;
    const from = (this.snapshot()['communications.default_from_email'] as string) ?? '';
    if (!from.trim()) return false;
    // On the shared domain a reply-to is not optional: without it replies reach us, not them,
    // and the send guard refuses. Mirror that here so the step cannot read as done while
    // sending would actually fail.
    if (this.usingPlatformAddress()) {
      const replyTo = (this.snapshot()['communications.reply_to'] as string) ?? '';
      return replyTo.trim().length > 0;
    }
    return true;
  });

  public readonly usingPlatformAddress = computed(() => {
    const platform = (this.snapshot()['communications.platform_from_email'] as string) ?? '';
    const from = (this.snapshot()['communications.default_from_email'] as string) ?? '';
    return !!platform && from.toLowerCase().trim() === platform.toLowerCase().trim();
  });

  public readonly demoDone = computed(() => !this.user()?.tenant_demo_mode_at);
  public readonly peopleDone = computed(() => (this._contactCount() ?? 0) > 0);

  /** Inviting teammates is genuinely optional, so it is never a blocker — only ever "not yet". */
  public readonly teamDone = computed(() => false);

  public readonly isDone = computed(
    (): Record<GoLiveStepId, boolean> => ({
      demo: this.demoDone(),
      plan: this.planDone(),
      organization: this.organizationDone(),
      phone: this.phoneDone(),
      sending: this.sendingDone(),
      people: this.peopleDone(),
      team: this.teamDone(),
    }),
  );

  /**
   * Steps whose server-side gate isn't satisfied yet, so the button would throw rather than work.
   *
   * Every billing mutation refuses while the demo data is in place (demo mode already gates as the
   * top tier, so there is nothing to buy), which is why the demo removal comes first and the plan
   * step is locked until it is done. Sender and phone verification then need a settled plan (the
   * backend's `assertPlanSelected`), so they stay locked until the plan is chosen.
   */
  public readonly lockedReason = computed((): Partial<Record<GoLiveStepId, string>> => {
    if (!this.demoDone()) {
      return {
        plan: 'Remove the demo data first',
        phone: 'Remove the demo data, then choose a plan',
      };
    }
    return this.planDone() ? {} : { phone: 'Choose a plan first' };
  });

  /** What is still outstanding once the wizard is closed — the dashboard checklist's input. */
  public readonly outstanding = computed<GoLiveStepId[]>(() => {
    const done = this.isDone();
    const steps: GoLiveStepId[] = ['demo', 'plan', 'organization', 'phone', 'sending', 'people'];
    return steps.filter((id) => !done[id]);
  });

  public async load(): Promise<void> {
    await this.settings.load().catch(() => undefined);
    this._state.set(this.readState());
    await Promise.all([this.refreshContacts(), this.refreshPlan(), this.refreshPhone()]);
  }

  /** Phone verification is the one derived step whose truth lives on the tenant rather than in
   * the settings snapshot, so it needs its own read — without it the step (and the dashboard
   * checklist behind it) would stay outstanding forever after a successful verification. */
  public async refreshPhone(): Promise<void> {
    try {
      const status = await this.settings.getPhoneVerificationStatus();
      this._phoneVerified.set(status.verified === true);
    } catch {
      this._phoneVerified.set(false);
    }
  }

  public async refreshContacts(): Promise<void> {
    try {
      this._contactCount.set((await this.persons.count()) ?? 0);
    } catch {
      this._contactCount.set(0);
    }
  }

  public async refreshPlan(): Promise<void> {
    try {
      const details = await this.api.billing.getDetails.query();
      this._hasPlan.set(details.hasActiveSubscription === true);
    } catch {
      this._hasPlan.set(false);
    }
  }

  /** Commit to Free. Not a checkout — Free is not purchasable, so it records the choice directly.
   * Refused server-side while the demo data is still in place, like every billing mutation. */
  public async selectFreePlan(): Promise<void> {
    await this.api.billing.selectFree.mutate();
    await this.refreshPlan();
    // The signed-in user carries `tenant_plan_selected`, which is what unlocks the verification
    // sections in Settings. Without this refresh they'd still claim to be locked.
    await this.auth.getCurrentUser().catch(() => undefined);
  }

  public setPhoneVerified(verified: boolean): void {
    this._phoneVerified.set(verified);
  }

  public async goTo(step: GoLiveStepId): Promise<void> {
    await this.patch({ step });
  }

  public async setSendsEmail(sendsEmail: boolean): Promise<void> {
    await this.patch({ sendsEmail });
  }

  /** Record a deliberate deferral. Idempotent, so re-deferring doesn't duplicate the entry. */
  public async defer(step: GoLiveStepId): Promise<void> {
    const deferred = this._state().deferred.includes(step) ? this._state().deferred : [...this._state().deferred, step];
    await this.patch({ deferred });
  }

  public async undefer(step: GoLiveStepId): Promise<void> {
    await this.patch({ deferred: this._state().deferred.filter((s) => s !== step) });
  }

  public async markComplete(): Promise<void> {
    await this.patch({ completedAt: new Date().toISOString() });
  }

  private async patch(partial: Partial<GoLiveState>): Promise<void> {
    const next = { ...this._state(), ...partial };
    this._state.set(next);
    try {
      await this.settings.upsert([{ key: GO_LIVE_SETTINGS_KEY, value: next }]);
    } catch {
      // Non-fatal: progress is a convenience, and every step's real work is saved on its own.
      // Losing "where I was" is survivable; blocking the user on it is not.
    }
  }

  private readState(): GoLiveState {
    const raw = this.snapshot()[GO_LIVE_SETTINGS_KEY];
    if (!raw || typeof raw !== 'object') return DEFAULT_STATE;
    const value = raw as Partial<GoLiveState>;
    return {
      step: value.step ?? DEFAULT_STATE.step,
      sendsEmail: typeof value.sendsEmail === 'boolean' ? value.sendsEmail : null,
      deferred: Array.isArray(value.deferred) ? value.deferred : [],
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
    };
  }
}
