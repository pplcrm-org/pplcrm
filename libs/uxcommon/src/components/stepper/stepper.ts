import { Component, computed, input, output } from '@angular/core';
import { Icon } from '@icons/icon';

/** Terminal states a step can end in besides simply being done. */
export type StepperStepState = 'done' | 'skipped' | 'deferred';

export interface StepperStep {
  id: string;
  label: string;
  /** Secondary line under the label — evidence or status ("1,842 imported", "DNS pending"). */
  note?: string;
  /**
   * Not yet reachable. Locked steps render muted and are not clickable, and they say why: a
   * greyed control with no reason is the confidence-killer §2 exists to prevent.
   */
  locked?: boolean;
  /** State-aware reason for the lock, e.g. "Choose a plan first". Shown as a tooltip. */
  lockedReason?: string;
  /**
   * Explicit terminal state. Left unset, a step before the current one counts as done — which is
   * right for a linear flow but wrong for one where steps can be skipped or deferred, so those
   * cases set it and the marker changes with them.
   */
  state?: StepperStepState;
}

/**
 * The one stepper. Horizontal pills for an inline flow (a composer, an import), vertical rail for
 * a full-page one (the go-live wizard).
 *
 * This exists because the pattern had been hand-rolled four times — the forms new-form stepper,
 * the list builder, the newsletter composer and the CSV import wizard — two of which had grown
 * their own independent `canReachStep()`. Reachability is expressed per step here rather than
 * through a callback so the host keeps owning the rules while the rendering stays in one place.
 */
@Component({
  selector: 'pc-stepper',
  imports: [Icon],
  template: `
    @if (orientation() === 'vertical') {
      <ol class="flex flex-col gap-0.5">
        @for (step of steps(); track step.id; let i = $index) {
          <li>
            <button
              type="button"
              class="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
              [class]="rowClass(step)"
              [disabled]="!!step.locked"
              [attr.title]="tooltip(step)"
              [attr.aria-current]="step.id === currentId() ? 'step' : null"
              (click)="select(step)"
            >
              <span
                class="mt-px flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border"
                [class]="markClass(step)"
              >
                @if (markIcon(step); as icon) {
                  <pc-icon [name]="icon" [size]="3"></pc-icon>
                } @else {
                  <span class="text-[9.5px] font-bold tabular-nums">{{ i + 1 }}</span>
                }
              </span>
              <span class="min-w-0">
                <span class="block text-xs leading-snug" [class]="labelClass(step)">{{ step.label }}</span>
                @if (step.note) {
                  <span class="mt-px block text-[10.5px] text-base-content/50">{{ step.note }}</span>
                }
              </span>
            </button>
          </li>
        }
      </ol>
    } @else {
      <ol class="flex flex-wrap items-center gap-2">
        @for (step of steps(); track step.id; let i = $index) {
          <li>
            <button
              type="button"
              class="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              [class]="pillClass(step)"
              [disabled]="!!step.locked"
              [attr.title]="tooltip(step)"
              [attr.aria-current]="step.id === currentId() ? 'step' : null"
              (click)="select(step)"
            >
              <span class="tabular-nums opacity-70">{{ i + 1 }}</span>
              {{ step.label }}
            </button>
          </li>
        }
      </ol>
    }
  `,
})
export class Stepper {
  public readonly steps = input.required<readonly StepperStep[]>();
  public readonly currentId = input.required<string>();
  public readonly orientation = input<'horizontal' | 'vertical'>('horizontal');

  /** Emits the step id when a reachable step is clicked. Locked steps never emit. */
  public readonly stepSelected = output<string>();

  private readonly currentIndex = computed(() => this.steps().findIndex((s) => s.id === this.currentId()));

  protected select(step: StepperStep): void {
    if (step.locked) return;
    this.stepSelected.emit(step.id);
  }

  /** The lock reason is the whole point of showing a disabled control at all. */
  protected tooltip(step: StepperStep): string | null {
    return step.locked ? (step.lockedReason ?? null) : null;
  }

  private resolvedState(step: StepperStep): StepperStepState | 'current' | 'todo' {
    if (step.id === this.currentId()) return 'current';
    if (step.state) return step.state;
    const index = this.steps().indexOf(step);
    return index >= 0 && this.currentIndex() >= 0 && index < this.currentIndex() ? 'done' : 'todo';
  }

  protected markIcon(step: StepperStep): 'check-circle' | 'exclamation-triangle' | null {
    const state = this.resolvedState(step);
    if (state === 'done') return 'check-circle';
    if (state === 'deferred') return 'exclamation-triangle';
    return null;
  }

  protected markClass(step: StepperStep): string {
    switch (this.resolvedState(step)) {
      case 'done':
        return 'border-success bg-success text-success-content';
      case 'deferred':
        return 'border-warning text-warning';
      case 'skipped':
        return 'border-dashed border-base-300 text-base-content/40';
      case 'current':
        return 'border-primary text-primary';
      default:
        return 'border-base-300 text-base-content/40';
    }
  }

  protected labelClass(step: StepperStep): string {
    switch (this.resolvedState(step)) {
      case 'current':
        return 'font-semibold text-primary';
      case 'skipped':
        return 'text-base-content/40';
      case 'todo':
        return 'text-base-content/60';
      default:
        return 'text-base-content/80';
    }
  }

  protected rowClass(step: StepperStep): string {
    if (step.id === this.currentId()) return 'bg-primary/10';
    return step.locked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-base-200/60';
  }

  protected pillClass(step: StepperStep): string {
    if (step.id === this.currentId()) return 'bg-primary text-primary-content';
    if (step.locked) return 'cursor-not-allowed bg-base-200/50 text-base-content/40';
    return 'cursor-pointer bg-primary/10 text-primary hover:bg-primary/20';
  }
}
