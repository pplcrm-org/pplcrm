import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormField } from '../../../../../../../libs/common/src';

import { FormDetail } from '../services/forms-service';

/**
 * Presentational render of a form's public card — the 440px card shown in the preview pane and,
 * later, on the public /f/:slug page. Phase 2 renders it read-only (structure only); the public
 * page (Phase 4) layers interactivity and validation on top.
 */
@Component({
  selector: 'pc-form-render',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto w-full max-w-[440px] pc-panel p-8" [class.opacity-70]="closed()">
      <div class="mb-5 flex items-center gap-2">
        <div
          class="flex size-7 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary"
        >
          {{ orgInitials() }}
        </div>
        <span class="text-sm font-medium text-base-content">{{ orgName() }}</span>
      </div>

      @if (closed()) {
        <h2 class="mb-2 text-2xl font-bold text-base-content">This form is closed</h2>
        <p class="text-sm text-base-content/60">{{ orgName() }} isn’t taking new responses here right now.</p>
      } @else {
        <h2 class="mb-2 text-2xl font-bold tracking-tight text-base-content">{{ form().name }}</h2>
        @if (form().description) {
          <p class="mb-6 text-sm leading-relaxed text-base-content/60">{{ form().description }}</p>
        } @else {
          <div class="mb-6"></div>
        }

        <div class="flex flex-col gap-6">
          @for (field of enabledFields(); track field.key) {
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-base-content">
                {{ field.label }}
                @if (field.required) {
                  <span class="text-base-content/50"> *</span>
                }
              </label>

              @switch (field.type) {
                @case ('area') {
                  <textarea
                    class="textarea textarea-bordered min-h-[76px] w-full resize-none bg-base-100 text-sm"
                    [placeholder]="field.placeholder ?? ''"
                    disabled
                  ></textarea>
                }
                @case ('select') {
                  <select class="select select-bordered w-full bg-base-100 text-sm" disabled>
                    @for (opt of field.options ?? []; track opt) {
                      <option>{{ opt }}</option>
                    }
                  </select>
                }
                @case ('checks') {
                  <div class="flex flex-col gap-2">
                    @for (opt of field.options ?? []; track opt) {
                      <label class="flex items-center gap-2 text-sm text-base-content">
                        <input type="checkbox" class="checkbox checkbox-sm" disabled />
                        {{ opt }}
                      </label>
                    }
                  </div>
                }
                @case ('checkbox') {
                  <label class="flex items-center gap-2 text-sm text-base-content">
                    <input type="checkbox" class="checkbox checkbox-sm" disabled />
                    Yes
                  </label>
                }
                @default {
                  <input
                    class="input input-bordered w-full bg-base-100 text-sm"
                    [placeholder]="field.placeholder ?? ''"
                    disabled
                  />
                }
              }

              @if (field.help) {
                <span class="text-xs text-base-content/50">{{ field.help }}</span>
              }
            </div>
          }

          <button class="btn btn-primary mt-1 w-full" type="button" disabled>
            {{ form().submit_label || 'Submit' }}
          </button>
        </div>
      }

      <p class="mt-6 text-center text-xs text-base-content/40">Powered by pplCRM</p>
    </div>
  `,
})
export class FormRenderComponent {
  public readonly form = input.required<FormDetail>();
  public readonly orgName = input<string>('Your organization');
  /** When true, render the "closed" card instead of the form (archived/unpublished public page). */
  public readonly closed = input<boolean>(false);

  protected readonly enabledFields = computed<FormField[]>(() => this.form().fields.filter((f) => f.on));

  protected readonly orgInitials = computed(() => {
    const name = this.orgName().trim();
    if (!name) return 'pC';
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'pC';
  });
}
