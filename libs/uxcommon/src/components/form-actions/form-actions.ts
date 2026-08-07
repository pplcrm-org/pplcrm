import { Component, inject, input, output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

/**
 * Minimal structural view of a signal-forms root (the object returned by
 * `form()` from '@angular/forms/signals'): calling it yields the root field
 * state. Kept structural so this shared control does not depend on the
 * experimental signal-forms types directly.
 */
export type SignalFormRoot = () => {
  dirty(): boolean;
  invalid(): boolean;
  reset(): void;
};

@Component({
  selector: 'pc-form-actions',
  imports: [Icon],
  templateUrl: './form-actions.html',
  // The host is a flex item wherever a page puts a button bar beside other content.
  // Without shrink-0 the host is squeezed to its min-content width while DaisyUI's
  // .btn keeps flex-shrink:0, so the buttons spill outside their own container.
  host: { class: 'shrink-0' },
})
export class FormActions {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private stay = false;

  public signalForm = input<SignalFormRoot>();

  public disabled = input<boolean>(false);

  /**
   * §4 "Save never disables": when true, the primary button stays enabled
   * regardless of validity/dirtiness (only `isLoading`/`disabled` gate it). The
   * consuming form is expected to guide on click (markAsTouched + focus the
   * first invalid field) rather than block via a dead button.
   */
  public saveAlwaysEnabled = input<boolean>(false);

  public showDelete = input<boolean>(false);

  /** Whether to render the Cancel button. Read/detail views turn this off — a
   * read view has no edit to cancel; the header's action is a navigation "Edit". */
  public showCancel = input<boolean>(true);

  public deleteText = input<string>('Delete');

  public readonly deleteClicked = output<void>();

  public readonly btn1Clicked = output<() => void>();

  public btn1Icon = input<PcIconNameType>('save');

  public btn1Text = input<string>('Save');

  public btn2Text = input<string>('Save & add more');

  public buttonsToShow = input<'two' | 'three'>('three');

  /** Button size; detail-header uses 'xs' to sit inline with the compact record pager. */
  public size = input<'xs' | 'sm'>('sm');

  public isLoading = input.required<boolean>();

  protected get isSaveDisabled(): boolean {
    if (this.isLoading()) return true;
    if (this.disabled()) return true;
    // Save never disables on validity/dirtiness — the form guides on click.
    if (this.saveAlwaysEnabled()) return false;
    const sigF = this.signalForm();
    if (sigF) {
      return sigF().invalid() || !sigF().dirty();
    }
    // No form at all: plain button bar (e.g. list-view) — never gate Save.
    return false;
  }

  public cancel(): void {
    void this.router.navigate(['../'], { relativeTo: this.route });
  }

  public handleDeleteClicked(): void {
    this.deleteClicked.emit();
  }

  public handleBtn1Clicked(): void {
    this.stay = false;
    this.btn1Clicked.emit(this.stayOrCancel);
  }

  public handleBtn2Clicked(): void {
    this.stay = true;
    this.btn1Clicked.emit(this.stayOrCancel);
  }

  public stayOrCancel = (): void => {
    if (this.stay) {
      this.signalForm()?.().reset();
    } else {
      this.cancel();
    }
  };
}
