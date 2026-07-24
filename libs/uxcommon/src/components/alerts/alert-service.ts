import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

export class AlertMessage {
  public readonly visible = signal(true);
  /** How many identical (same text+type) toasts have coalesced into this one (§2). */
  public readonly count = signal(1);

  public duration = 3000;
  public id: string;
  public text: string;
  public timeoutId: NodeJS.Timeout | undefined;
  public type?: ALERTTYPE;

  constructor(init?: Partial<AlertMessage>) {
    Object.assign(this, init);
    this.id = init?.id ?? crypto.randomUUID();
    this.duration = init?.duration || 3000;
    this.text = init?.text ?? 'Alert';
  }
}

/** Max simultaneous toasts; oldest drops when a new one arrives (§2). */
const MAX_TOAST_STACK = 3;

@Injectable({
  providedIn: 'root',
})
export class AlertService {
  private readonly alertsSignal = signal<AlertMessage[]>([]);

  /**
   * Epoch-ms deadline until which {@link showError} drops error toasts. Armed by the app on a
   * sign-out redirect: a dead session makes every in-flight query fail with UNAUTHORIZED at once,
   * and each caller would otherwise raise its own misleading "Failed to load …" error — noise that
   * is both wrong (the real cause is the expired session) and redundant with the sign-in redirect.
   * Only errors are muted; info/success toasts (e.g. the "please sign in again" nudge) still show.
   */
  private errorsMutedUntil = 0;

  public readonly alertList = this.alertsSignal.asReadonly();
  public readonly alerts$ = toObservable(this.alertsSignal);

  public dismiss(id: string): void {
    const alert = this.findById(id);

    if (!alert) return;

    // Clear any pending removal timeout
    clearTimeout(alert.timeoutId);
    alert.timeoutId = undefined;

    alert.visible.set(false);

    // Have to let the animation do its thing first
    setTimeout(() => {
      const next = this.alertsSignal().filter((msg) => msg.id !== id);
      this.alertsSignal.set(next);
    }, 300);
  }

  public getAlerts(): AlertMessage[] {
    return this.alertsSignal();
  }

  /** Suppress error toasts for the next `ms` (see {@link errorsMutedUntil}). Used on sign-out. */
  public muteErrorsFor(ms: number): void {
    this.errorsMutedUntil = Date.now() + ms;
  }

  public show(alert: Partial<AlertMessage>): void {
    // Coalesce an identical (same text + type) toast into a ×N count with a
    // refreshed timer instead of stacking duplicates (§2).
    const existing = this.alertsSignal().find((m) => m.text === alert.text && m.type === alert.type);

    if (existing) {
      existing.count.update((c) => c + 1);
      clearTimeout(existing.timeoutId);
      existing.timeoutId = setTimeout(() => this.dismiss(existing.id), existing.duration || 3000);
      return;
    }

    const messageWithMeta: AlertMessage = new AlertMessage({ ...alert });
    // Cap the stack at MAX_TOAST_STACK, dropping the oldest (list is newest-first).
    this.alertsSignal.update((list) => {
      const next = [messageWithMeta, ...list];
      const dropped = next.slice(MAX_TOAST_STACK);
      dropped.forEach((m) => clearTimeout(m.timeoutId));
      return next.slice(0, MAX_TOAST_STACK);
    });

    const duration = messageWithMeta.duration || 3000;
    messageWithMeta.timeoutId = setTimeout(() => this.dismiss(messageWithMeta.id), duration);
  }

  public showError(text: string): void {
    // A sign-out in progress mutes the burst of "Failed to load …" toasts its 401s would raise.
    if (Date.now() < this.errorsMutedUntil) return;
    this.show(new AlertMessage({ text, type: 'error' }));
  }

  public showInfo(text: string): void {
    this.show(new AlertMessage({ text, type: 'info' }));
  }

  public showSuccess(text: string): void {
    this.show(new AlertMessage({ text, type: 'success' }));
  }

  public showWarn(text: string): void {
    this.show(new AlertMessage({ text, type: 'warning' }));
  }

  private findById(id: string) {
    return this.alertsSignal().find((m) => m.id === id);
  }
}

export type ALERTTYPE = 'info' | 'error' | 'warning' | 'success';
