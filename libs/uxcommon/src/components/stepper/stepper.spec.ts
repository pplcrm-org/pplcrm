import { Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { Stepper, type StepperStep } from './stepper';

@Component({
  imports: [Stepper],
  template: `
    <pc-stepper
      [steps]="steps()"
      [currentId]="currentId()"
      [orientation]="orientation()"
      (stepSelected)="selected.set($event)"
    ></pc-stepper>
  `,
})
class Host {
  public readonly steps = signal<StepperStep[]>([]);
  public readonly currentId = signal('a');
  public readonly orientation = signal<'horizontal' | 'vertical'>('vertical');
  public readonly selected = signal<string | null>(null);
}

describe('Stepper', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const buttons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    host.steps.set([
      { id: 'a', label: 'Plan' },
      { id: 'b', label: 'Organization' },
      { id: 'c', label: 'Sending' },
    ]);
    host.currentId.set('b');
    fixture.detectChanges();
  });

  it('renders one control per step and marks the current one', () => {
    expect(buttons()).toHaveLength(3);
    expect(buttons()[1].getAttribute('aria-current')).toBe('step');
    expect(buttons()[0].getAttribute('aria-current')).toBeNull();
  });

  it('emits the id of a reachable step', () => {
    buttons()[0].click();
    expect(host.selected()).toBe('a');
  });

  /**
   * A locked step must be inert AND say why. A greyed control with no reason is the
   * confidence-killer the disclosure rule exists to prevent, and it is exactly what the
   * hand-rolled copies handled inconsistently.
   */
  it('does not emit for a locked step, and surfaces the reason', () => {
    host.steps.set([
      { id: 'a', label: 'Plan' },
      { id: 'b', label: 'Organization' },
      { id: 'c', label: 'Sending', locked: true, lockedReason: 'Set your organization address first' },
    ]);
    fixture.detectChanges();

    const locked = buttons()[2];
    expect(locked.disabled).toBe(true);
    expect(locked.getAttribute('title')).toBe('Set your organization address first');

    locked.click();
    expect(host.selected()).toBeNull();
  });

  it('treats steps before the current one as done by default', () => {
    // The first step is behind the current one, so it renders with the success marker.
    expect(buttons()[0].querySelector('pc-icon')).not.toBeNull();
    expect(buttons()[2].querySelector('pc-icon')).toBeNull();
  });

  /**
   * Position-implies-done is right for a linear flow and wrong for one where steps can be
   * skipped or deferred — the go-live wizard's whole point is that deferring is legitimate, so a
   * deferred step must not read as complete.
   */
  it('lets an explicit state override position', () => {
    host.steps.set([
      { id: 'a', label: 'Plan', state: 'skipped' },
      { id: 'b', label: 'Organization' },
      { id: 'c', label: 'Sending', state: 'deferred' },
    ]);
    fixture.detectChanges();

    // Skipped is not done: no completion marker even though it sits before the current step.
    expect(buttons()[0].querySelector('pc-icon')).toBeNull();
    // Deferred is called out even though it sits after the current step.
    expect(buttons()[2].querySelector('pc-icon')).not.toBeNull();
  });

  it('renders notes when supplied', () => {
    host.steps.set([{ id: 'a', label: 'Your people', note: '1,842 imported' }]);
    host.currentId.set('a');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1,842 imported');
  });

  it('renders horizontally without losing behaviour', () => {
    host.orientation.set('horizontal');
    fixture.detectChanges();

    expect(buttons()).toHaveLength(3);
    buttons()[0].click();
    expect(host.selected()).toBe('a');
  });
});
