import { Component, signal, type WritableSignal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { loadingGate } from '../../loading-gate';
import { DetailLayout } from './detail-layout';

/**
 * A loading gate whose timers are driven by the test instead of by the clock.
 * `visible` is the delayed + minimum-held indicator flag; `loaded` flips once a load
 * has finished at least once.
 */
type StubGate = loadingGate & { visible: WritableSignal<boolean>; loaded: WritableSignal<boolean> };

function stubGate(state: { visible?: boolean; loaded?: boolean } = {}): StubGate {
  const visible = signal(state.visible ?? false);
  const loaded = signal(state.loaded ?? false);
  const active = signal(false);
  return { visible, loaded, active, begin: () => () => undefined };
}

@Component({
  template: `
    <pc-detail-layout [title]="'Jane Doe'" [gate]="gate">
      <p>Projected body</p>
    </pc-detail-layout>
  `,
  imports: [DetailLayout],
})
class HostComponent {
  public readonly gate = stubGate({ loaded: true });
}

describe('DetailLayout', () => {
  let fixture: ComponentFixture<DetailLayout>;
  let component: DetailLayout;
  let gate: StubGate;
  const appendedElements: HTMLElement[] = [];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailLayout],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DetailLayout);
    component = fixture.componentInstance;
    gate = stubGate();
    fixture.componentRef.setInput('title', 'Jane Doe');
    fixture.componentRef.setInput('gate', gate);
  });

  afterEach(() => {
    for (const el of appendedElements.splice(0)) {
      el.remove();
    }
  });

  describe('body states', () => {
    /** The regression this component exists to prevent: a record page must not accuse the
     * user of a missing record while its very first fetch is still in flight. */
    it('shows nothing — no skeleton, no not-found alert — before the first load settles', () => {
      fixture.componentRef.setInput('hasRecord', false);
      fixture.componentRef.setInput('notFoundText', 'No such person');
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.skeleton'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.alert-error'))).toBeNull();
    });

    it('shows the skeleton once the gate reveals the indicator with no record on screen', () => {
      fixture.componentRef.setInput('hasRecord', false);
      gate.visible.set(true);
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.skeleton'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.alert-error'))).toBeNull();
    });

    /** The gate holds its indicator for a minimum duration. If the record landing mid-hold
     * swapped the skeleton out, that swap would be the brief flash the hold prevents. */
    it('keeps the skeleton up when the record arrives while the gate is still holding', () => {
      fixture.componentRef.setInput('hasRecord', false);
      gate.visible.set(true);
      fixture.detectChanges();

      gate.loaded.set(true);
      fixture.componentRef.setInput('hasRecord', true);
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.skeleton'))).not.toBeNull();

      gate.visible.set(false);
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.skeleton'))).toBeNull();
    });

    it('shows the error alert when error is set and the gate is idle', () => {
      gate.loaded.set(true);
      fixture.componentRef.setInput('error', 'Something went wrong');
      fixture.detectChanges();

      const alert = fixture.debugElement.query(By.css('.alert-error'));
      expect(alert).not.toBeNull();
      expect(alert.nativeElement.textContent).toContain('Something went wrong');
      expect(fixture.debugElement.query(By.css('.skeleton'))).toBeNull();
    });

    it('shows the not-found alert once the load settled with no record and no error', () => {
      gate.loaded.set(true);
      fixture.componentRef.setInput('hasRecord', false);
      fixture.componentRef.setInput('notFoundText', 'No such person');
      fixture.detectChanges();

      const alert = fixture.debugElement.query(By.css('.alert-error'));
      expect(alert).not.toBeNull();
      expect(alert.nativeElement.textContent).toContain('No such person');
    });

    it('prioritizes the skeleton over an error', () => {
      fixture.componentRef.setInput('hasRecord', false);
      gate.visible.set(true);
      fixture.componentRef.setInput('error', 'boom');
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.skeleton'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.alert-error'))).toBeNull();
    });

    it('prioritizes the error state over not-found', () => {
      gate.loaded.set(true);
      fixture.componentRef.setInput('error', 'boom');
      fixture.componentRef.setInput('hasRecord', false);
      fixture.componentRef.setInput('notFoundText', 'No such person');
      fixture.detectChanges();

      const alert = fixture.debugElement.query(By.css('.alert-error'));
      expect(alert.nativeElement.textContent).toContain('boom');
      expect(alert.nativeElement.textContent).not.toContain('No such person');
    });

    it('projects main content when the load settled, there is no error, and a record is present', async () => {
      const hostFixture = TestBed.createComponent(HostComponent);
      hostFixture.detectChanges();
      await hostFixture.whenStable();
      hostFixture.detectChanges();

      expect(hostFixture.debugElement.query(By.css('.skeleton'))).toBeNull();
      expect(hostFixture.debugElement.query(By.css('.alert-error'))).toBeNull();
      const projected = hostFixture.debugElement.query(By.css('p'));
      expect(projected.nativeElement.textContent.trim()).toBe('Projected body');
    });

    /** Refetching with a record already on screen keeps that record visible and dims it,
     * rather than replacing it with a skeleton (React transitions / TanStack Query
     * keepPreviousData both behave this way). */
    it('keeps the record on screen and dims it while a refetch is in flight', async () => {
      const hostFixture = TestBed.createComponent(HostComponent);
      hostFixture.detectChanges();
      await hostFixture.whenStable();
      hostFixture.detectChanges();

      hostFixture.componentInstance.gate.visible.set(true);
      hostFixture.detectChanges();

      expect(hostFixture.debugElement.query(By.css('.skeleton'))).toBeNull();
      expect(hostFixture.debugElement.query(By.css('p')).nativeElement.textContent.trim()).toBe('Projected body');
      expect(hostFixture.debugElement.query(By.css('.opacity-60'))).not.toBeNull();
    });
  });

  describe('keyboard navigation (document:keydown)', () => {
    function dispatchKey(key: string, opts: Partial<KeyboardEventInit> = {}, target?: EventTarget): void {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
      (target ?? document).dispatchEvent(event);
    }

    beforeEach(() => {
      fixture.componentRef.setInput('positionLabel', '2 of 5 filtered');
    });

    it('does nothing when there is no positionLabel', () => {
      fixture.componentRef.setInput('positionLabel', null);
      fixture.componentRef.setInput('hasNext', true);
      fixture.componentRef.setInput('hasPrev', true);
      fixture.detectChanges();

      const nextSpy = vi.fn();
      const prevSpy = vi.fn();
      component.nextRecord.subscribe(nextSpy);
      component.prevRecord.subscribe(prevSpy);

      dispatchKey('j');
      dispatchKey('k');

      expect(nextSpy).not.toHaveBeenCalled();
      expect(prevSpy).not.toHaveBeenCalled();
    });

    it('emits nextRecord on "j" when hasNext is true, and prevents default', () => {
      fixture.componentRef.setInput('hasNext', true);
      fixture.detectChanges();

      const nextSpy = vi.fn();
      component.nextRecord.subscribe(nextSpy);

      const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
      document.dispatchEvent(event);

      expect(nextSpy).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not emit nextRecord on "j" when hasNext is false', () => {
      fixture.componentRef.setInput('hasNext', false);
      fixture.detectChanges();

      const nextSpy = vi.fn();
      component.nextRecord.subscribe(nextSpy);

      dispatchKey('j');

      expect(nextSpy).not.toHaveBeenCalled();
    });

    it('emits prevRecord on "K" (case-insensitive) when hasPrev is true', () => {
      fixture.componentRef.setInput('hasPrev', true);
      fixture.detectChanges();

      const prevSpy = vi.fn();
      component.prevRecord.subscribe(prevSpy);

      dispatchKey('K');

      expect(prevSpy).toHaveBeenCalledTimes(1);
    });

    it('does not emit prevRecord on "k" when hasPrev is false', () => {
      fixture.componentRef.setInput('hasPrev', false);
      fixture.detectChanges();

      const prevSpy = vi.fn();
      component.prevRecord.subscribe(prevSpy);

      dispatchKey('k');

      expect(prevSpy).not.toHaveBeenCalled();
    });

    it('ignores the key when a modifier key is held', () => {
      fixture.componentRef.setInput('hasNext', true);
      fixture.detectChanges();

      const nextSpy = vi.fn();
      component.nextRecord.subscribe(nextSpy);

      dispatchKey('j', { ctrlKey: true });
      dispatchKey('j', { metaKey: true });
      dispatchKey('j', { altKey: true });

      expect(nextSpy).not.toHaveBeenCalled();
    });

    it('ignores the key when the event target is an editable input', () => {
      fixture.componentRef.setInput('hasNext', true);
      fixture.detectChanges();

      const input = document.createElement('input');
      document.body.appendChild(input);
      appendedElements.push(input);

      const nextSpy = vi.fn();
      component.nextRecord.subscribe(nextSpy);

      dispatchKey('j', {}, input);

      expect(nextSpy).not.toHaveBeenCalled();
    });
  });
});
