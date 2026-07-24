import { TestBed } from '@angular/core/testing';
import { AlertService } from './alert-service';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DEFAULT_DURATION_MS = 3000;
const EXIT_ANIMATION_MS = 300;

describe('AlertService', () => {
  let service: AlertService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(AlertService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a toast and auto-dismisses after its duration plus the exit delay', () => {
    service.showSuccess('Saved');
    expect(service.getAlerts()).toHaveLength(1);
    expect(service.getAlerts()[0].visible()).toBe(true);

    vi.advanceTimersByTime(DEFAULT_DURATION_MS);
    expect(service.getAlerts()[0].visible()).toBe(false);

    vi.advanceTimersByTime(EXIT_ANIMATION_MS);
    expect(service.getAlerts()).toHaveLength(0);
  });

  it('coalesces identical text+type into one toast with an incremented count', () => {
    service.showInfo('Deleted 1 person');
    service.showInfo('Deleted 1 person');
    const alerts = service.getAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count()).toBe(2);
  });

  it('does not coalesce the same text with a different type', () => {
    service.showInfo('Done');
    service.showError('Done');
    expect(service.getAlerts()).toHaveLength(2);
  });

  it('refreshes the dismiss timer when a duplicate coalesces', () => {
    service.showInfo('Working');
    vi.advanceTimersByTime(DEFAULT_DURATION_MS - 100);
    service.showInfo('Working');

    // The original timer would have fired by now; the refreshed one has not.
    vi.advanceTimersByTime(DEFAULT_DURATION_MS - 100);
    expect(service.getAlerts()).toHaveLength(1);
    expect(service.getAlerts()[0].visible()).toBe(true);

    vi.advanceTimersByTime(100 + EXIT_ANIMATION_MS);
    expect(service.getAlerts()).toHaveLength(0);
  });

  it('caps the stack at 3, dropping the oldest first', () => {
    service.showInfo('one');
    service.showInfo('two');
    service.showInfo('three');
    service.showInfo('four');
    // Newest-first internal ordering; 'one' was dropped.
    expect(service.getAlerts().map((a) => a.text)).toEqual(['four', 'three', 'two']);
  });

  it('clears the dismiss timer of a dropped toast', () => {
    service.showInfo('one');
    const oldest = service.getAlerts()[0];
    service.showInfo('two');
    service.showInfo('three');

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    service.showInfo('four');
    expect(clearSpy).toHaveBeenCalledWith(oldest.timeoutId);
  });

  it('dismiss hides the toast immediately and removes it after the exit delay', () => {
    service.showSuccess('Saved');
    const id = service.getAlerts()[0].id;

    service.dismiss(id);
    expect(service.getAlerts()[0].visible()).toBe(false);

    vi.advanceTimersByTime(EXIT_ANIMATION_MS);
    expect(service.getAlerts()).toHaveLength(0);
  });

  it('dismiss with an unknown id is a no-op', () => {
    service.showSuccess('Saved');
    service.dismiss('not-a-real-id');
    vi.advanceTimersByTime(EXIT_ANIMATION_MS);
    expect(service.getAlerts()).toHaveLength(1);
  });

  describe('muteErrorsFor', () => {
    it('drops error toasts within the mute window but still shows info and success', () => {
      service.muteErrorsFor(DEFAULT_DURATION_MS);

      service.showError('Failed to load dashboard metrics');
      expect(service.getAlerts()).toHaveLength(0);

      service.showInfo('Your session has expired. Please sign in again.');
      service.showSuccess('Saved');
      expect(service.getAlerts().map((a) => a.type)).toEqual(['success', 'info']);
    });

    it('shows error toasts again once the mute window has elapsed', () => {
      service.muteErrorsFor(DEFAULT_DURATION_MS);
      vi.advanceTimersByTime(DEFAULT_DURATION_MS);

      service.showError('Something went wrong');
      expect(service.getAlerts()).toHaveLength(1);
    });
  });
});
