import { Component, inject, output, signal, viewChild } from '@angular/core';
import { form, submit, FormField, validateStandardSchema } from '@angular/forms/signals';
import { TagsService } from '@experiences/tags/services/tags-service';
import { AddTagObj } from '../../../../../../../libs/common/src';

import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';

function randomHexColor(): string {
  return (
    '#' +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
  );
}

/** Fig. 11 "New issue" — a popup, not a routed page, so adding an issue never leaves the admin table. */
@Component({
  selector: 'pc-add-issue-dialog',
  imports: [PcInput, FormField, Icon, ModalShell],
  template: `<pc-modal-shell #dlg title="New issue" icon="add-issue" [boxClass]="'max-w-md'" [dismissible]="false">
    <form id="add-issue-form" (submit)="add($event)" class="flex flex-col gap-4" novalidate>
      <div class="flex flex-col gap-2">
        <label i18n class="label text-sm"> Enter a unique issue name (and optionally, give it a description) </label>
        <pc-input placeholder="Issue Name" i18n-placeholder [formField]="form.name"></pc-input>
        <pc-input placeholder="Optional description" i18n-placeholder [formField]="form.description"></pc-input>
        <div class="flex items-center gap-2">
          <label i18n class="label-text text-sm">Colour</label>
          <input
            class="input input-bordered input-sm w-24"
            type="color"
            [formField]="form.color"
            [class.input-error]="form.color().invalid() && (form.color().dirty() || form.color().touched())"
          />
          @if (form.color().invalid() && (form.color().dirty() || form.color().touched())) {
            @for (err of form.color().errors(); track err) {
              <span class="text-error text-xs">{{ err.message }}</span>
            }
          }
        </div>
      </div>
    </form>

    <div pc-modal-footer class="flex gap-2">
      <button type="button" class="btn btn-ghost" (click)="close()" [disabled]="isLoading()">Cancel</button>
      <button type="submit" form="add-issue-form" class="btn btn-primary gap-2" [disabled]="isLoading()">
        @if (isLoading()) {
          <span class="loading loading-spinner loading-xs"></span>
        } @else {
          <pc-icon name="add-issue" [size]="4"></pc-icon>
        }
        Add issue
      </button>
    </div>
  </pc-modal-shell>`,
})
export class AddIssueDialog {
  private readonly alertSvc = inject(AlertService);
  private readonly tagSvc = inject(TagsService);
  private readonly tagOptionsSvc = inject(TagOptionsService);

  private readonly dlgRef = viewChild.required<ModalShell>('dlg');

  private _loading = createLoadingGate();

  protected readonly payload = signal({
    name: '',
    description: '',
    color: randomHexColor(),
  });

  public readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, AddTagObj);
  });

  protected isLoading = this._loading.visible;

  public readonly saved = output<void>();

  public open(): void {
    this.payload.set({ name: '', description: '', color: randomHexColor() });
    this.form().reset();
    this.dlgRef().show();
  }

  public close(): void {
    this.dlgRef().close();
  }

  protected async add(event?: Event) {
    if (event) {
      event.preventDefault();
    }

    if (this.isLoading()) return;

    this.form().markAsTouched();
    if (!this.form().valid) return;

    await submit(this.form, {
      action: async () => {
        const end = this._loading.begin();
        try {
          const formObj = this.payload();
          await this.tagSvc.add({ ...formObj, type: 'issue' });
          await this.tagOptionsSvc.invalidate('issue');
          this.tagSvc.triggerRefresh();
          this.alertSvc.showSuccess('Issue added successfully.');
          this.saved.emit();
          this.close();
        } catch (err) {
          this.alertSvc.showError(
            err instanceof Error && err.message ? err.message : "We've hit an unknown error. Please try again.",
          );
        } finally {
          end();
        }
        return null;
      },
    });
  }
}
