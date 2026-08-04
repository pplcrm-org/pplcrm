import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Icon } from '@uxcommon/components/icons/icon';
import { ConfirmDialogService, DialogVariant } from './confirm-dialog.service';

@Component({
  selector: 'pc-dialog-host',
  imports: [Icon],
  templateUrl: './confirm-dialog-host.html',
})
export class ConfirmDialogHost {
  private readonly svc = inject(ConfirmDialogService);

  public readonly promptValue = signal(''); // bound via [value] + (input) in the template

  private readonly stateSignal = this.svc.stateSignal;
  private readonly openSignal = this.svc.isOpenSignal;
  public state = this.stateSignal;
  // §7.4: destructive dialogs style the SAFE action as primary. Danger variants
  // default to emphasizing the cancel/keep button unless a caller opts out, and
  // only when a cancel button is actually shown.
  public readonly effectiveEmphasizeCancel = computed(() => {
    const st = this.state();
    if (!st) return false;
    const explicit = st.emphasizeCancel;
    const wants = explicit ?? st.variant === 'danger';
    return wants && this.showCancel();
  });
  public confirmBtnClass = computed(() => {
    const v = (this.state()?.variant ?? 'neutral') as DialogVariant;
    if (this.effectiveEmphasizeCancel()) {
      switch (v) {
        case 'danger':
          return 'btn-ghost text-error';
        case 'warning':
          return 'btn-ghost text-warning';
        case 'info':
          return 'btn-ghost text-info';
        case 'success':
          return 'btn-ghost text-success';
        default:
          return 'btn-ghost';
      }
    }
    // UX-GUIDELINES §4b: destructive/archive confirms wear the outline role classes;
    // affirmative confirms (info/success/neutral) are the surface's main action.
    switch (v) {
      case 'danger':
        return 'btn-outline btn-error';
      case 'warning':
        return 'btn-outline btn-warning';
      case 'info':
      case 'success':
      default:
        return 'btn-primary';
    }
  });

  // Mirror the confirm side: whenever the destructive/confirm action is de-emphasized
  // (danger variants by default, or any explicit emphasizeCancel), style the safe
  // cancel/keep action as the primary default so there is always a clear safe default (§7.4).
  // Default cancel wears the house cancel style (UX-GUIDELINES "Buttons"): outline accent.
  public cancelBtnClass = computed(() => (this.effectiveEmphasizeCancel() ? 'btn-primary' : 'btn-outline btn-accent'));

  public choiceBtnClass(v?: DialogVariant): string {
    if (!v) return '';
    switch (v) {
      case 'danger':
        return 'btn-outline btn-error';
      case 'warning':
        return 'btn-outline btn-warning';
      case 'info':
      case 'success':
        return 'btn-primary';
      default:
        return '';
    }
  }

  public readonly dlgRef = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  public icon = computed(() => this.state()?.icon ?? this.svc.defaultIconFor('neutral'));
  public showCancel = computed(() => {
    const st = this.state();
    if (!st) return false;
    if (st.type === 'choose') {
      return !!st.cancelText;
    }
    return !!st.cancelText && st.type !== 'alert';
  });

  constructor() {
    effect(() => {
      const open = this.openSignal();
      const dlg = this.dlgRef()?.nativeElement;
      if (!dlg) return;

      if (open) {
        this.promptValue.set(this.stateSignal()?.defaultValue ?? '');
        if (!dlg.open) {
          try {
            dlg.showModal();
          } catch {}
        }
      } else if (dlg.open) {
        try {
          dlg.close();
        } catch {}
      }
    });
  }

  public onPromptInput(event: Event): void {
    this.promptValue.set((event.target as HTMLInputElement).value);
  }

  public onBackdrop(): void {
    const st = this.state();
    if (st?.allowBackdropClose) this.svc.cancel();
  }

  /**
   * Escape closes a native <dialog> by itself. Refuse it on a dialog the caller
   * marked non-dismissible (allowBackdropClose: false), the same rule ModalShell
   * applies — otherwise the dialog disappears while the caller keeps waiting.
   */
  public onNativeCancel(event: Event): void {
    const st = this.state();
    if (st && !st.allowBackdropClose) event.preventDefault();
  }

  /**
   * Every close path the browser performs itself (Escape, the backdrop form's
   * method="dialog" submit) ends here, so the waiting promise is always settled
   * with the dialog's cancel value.
   *
   * ok()/cancel() clear the dialog state before the effect closes the element,
   * so the close event they trigger arrives with no state and no pending
   * resolver: the state guard below, and the service's optional call on its
   * resolver, both make that a no-op. No promise is settled twice.
   */
  public onNativeClose(): void {
    if (this.state()) this.svc.cancel();
  }

  public onCancel(): void {
    this.svc.cancel();
  }

  public onConfirm(): void {
    const st = this.state();
    if (!st) return;
    if (st.type === 'prompt') this.svc.ok(this.promptValue());
    else if (st.type === 'alert') this.svc.ok();
    else this.svc.ok(true);
  }

  public onChoice(value: unknown): void {
    this.svc.ok(value);
  }
}
