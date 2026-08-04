import { signal, computed, Service } from '@angular/core';
import type { PcIconNameType } from '@icons/icons.index';

export interface DialogChoice<T = any> {
  label: string;
  value: T;
  variant?: DialogVariant;
}

export interface ChooseOptions<T = any> {
  allowBackdropClose?: boolean;
  cancelText?: string;
  choices: DialogChoice<T>[];
  icon?: PcIconNameType;
  message?: string;
  title: string;
  variant?: DialogVariant;
}

export interface BaseDialogOptions {
  allowBackdropClose?: boolean; // default true for alert/prompt, false for danger confirm
  cancelText?: string; // default per type
  confirmText?: string; // default per type
  /** Style cancel as the primary/safe-default button and confirm as a plain variant-colored one (e.g. "Keep editing" vs. "Discard changes"). */
  emphasizeCancel?: boolean;
  icon?: PcIconNameType; // optional icon name for <pc-icon>
  message?: string;
  title: string;
  variant?: DialogVariant;
}

export interface DialogState {
  allowBackdropClose: boolean;
  cancelText: string;
  confirmText: string;
  defaultValue?: string;
  emphasizeCancel?: boolean;
  icon?: PcIconNameType;

  // prompt
  inputPlaceholder?: string;
  message?: string;
  title: string;
  type: DialogType;
  variant: DialogVariant;

  // choose
  choices?: DialogChoice[];
}

export interface PromptOptions extends BaseDialogOptions {
  defaultValue?: string;
  inputPlaceholder?: string;
}

@Service()
export class ConfirmDialogService {
  private _resolve: ((value?: any) => void) | null = null;

  public readonly stateSignal = signal<DialogState | null>(null);

  public readonly isOpenSignal = computed(() => this.stateSignal() !== null);

  public alert(opts: BaseDialogOptions): Promise<void> {
    this.open({
      type: 'alert',
      title: opts.title,
      message: opts.message,
      variant: opts.variant ?? 'info',
      icon: opts.icon ?? this.defaultIconFor(opts.variant ?? 'info'),
      allowBackdropClose: opts.allowBackdropClose ?? true,
      confirmText: 'OK',
      cancelText: '',
    });
    return new Promise<void>((resolve) => (this._resolve = resolve));
  }

  public cancel(): void {
    // Normalize cancel values per dialog type
    const st = this.stateSignal();
    if (st?.type === 'confirm') this._resolve?.(false);
    else if (st?.type === 'alert') this._resolve?.();
    else if (st?.type === 'prompt') this._resolve?.(null);
    else if (st?.type === 'choose') this._resolve?.(null);
    this.close();
  }

  public confirm(opts: BaseDialogOptions): Promise<boolean> {
    const v = opts.variant ?? 'neutral';
    const allowBackdropClose = opts.allowBackdropClose ?? v !== 'danger';
    const confirmText = opts.confirmText ?? (v === 'danger' ? 'Delete' : 'OK');
    const cancelText = opts.cancelText ?? 'Cancel';

    this.open({
      type: 'confirm',
      title: opts.title,
      message: opts.message,
      variant: v,
      icon: opts.icon ?? this.defaultIconFor(v),
      allowBackdropClose,
      confirmText,
      cancelText,
      emphasizeCancel: opts.emphasizeCancel,
    });

    return new Promise<boolean>((resolve) => (this._resolve = resolve));
  }

  public choose<T>(opts: ChooseOptions<T>): Promise<T | null> {
    const v = opts.variant ?? 'neutral';
    this.open({
      type: 'choose',
      title: opts.title,
      message: opts.message,
      variant: v,
      icon: opts.icon ?? this.defaultIconFor(v),
      allowBackdropClose: opts.allowBackdropClose ?? true,
      confirmText: '',
      cancelText: opts.cancelText ?? 'Cancel',
      choices: opts.choices,
    });

    return new Promise<T | null>((resolve) => (this._resolve = resolve));
  }

  public defaultIconFor(variant: DialogVariant): PcIconNameType {
    switch (variant) {
      case 'danger':
        return 'exclamation-triangle';
      case 'warning':
        return 'exclamation-circle';
      case 'info':
        return 'information-circle';
      case 'success':
        return 'check-circle';
      default:
        return 'x-mark';
    }
  }

  public ok(payload?: unknown): void {
    this._resolve?.(payload ?? true);
    this.close();
  }

  public prompt(opts: PromptOptions): Promise<string | null> {
    this.open({
      type: 'prompt',
      title: opts.title,
      message: opts.message,
      variant: opts.variant ?? 'neutral',
      icon: opts.icon ?? ('pencil-square' as PcIconNameType),
      allowBackdropClose: opts.allowBackdropClose ?? true,
      confirmText: opts.confirmText ?? 'OK',
      cancelText: opts.cancelText ?? 'Cancel',
      inputPlaceholder: opts.inputPlaceholder,
      defaultValue: opts.defaultValue,
    });
    return new Promise<string | null>((resolve) => (this._resolve = resolve));
  }

  private close(): void {
    this.stateSignal.set(null);
    this._resolve = null;
  }

  private open(st: DialogState): void {
    // Only one dialog can be pending at a time. If a second one opens while the
    // first is still awaited, settle the first with its own cancel value instead
    // of dropping its resolver — a dropped resolver hangs its caller forever.
    if (this._resolve) this.cancel();
    this.stateSignal.set(st);
  }
}

export type DialogType = 'confirm' | 'alert' | 'prompt' | 'choose';

export type DialogVariant = 'danger' | 'warning' | 'info' | 'success' | 'neutral';
