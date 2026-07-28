import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsService } from '../../experiences/settings/services/settings-service';
import { DateFormatService } from './date-format.service';

/**
 * An absolute instant, not a local wall clock: the service renders in the *workspace* zone
 * (America/Toronto by default), so `'2026-01-15T00:00:00'` would be Jan 15 in Toronto on a
 * Toronto machine but Jan 14 19:00 on a UTC runner. Noon UTC is midday Jan 15 in Toronto, far
 * enough from either midnight that the assertions hold whatever TZ the runner uses.
 */
const JAN_15 = '2026-01-15T12:00:00Z';

describe('DateFormatService', () => {
  let service: DateFormatService;
  let snapshot: ReturnType<typeof signal<Record<string, unknown>>>;

  beforeEach(() => {
    snapshot = signal<Record<string, unknown>>({});
    TestBed.configureTestingModule({
      providers: [DateFormatService, { provide: SettingsService, useValue: { snapshotSignal: snapshot } }],
    });
    service = TestBed.inject(DateFormatService);
  });

  it('falls back to the project default pattern when the setting is unset or blank', () => {
    expect(service.pattern()).toBe('MMMM d, yyyy');

    snapshot.set({ 'appearance.date_format': '   ' });
    expect(service.pattern()).toBe('MMMM d, yyyy');
  });

  it('reflects the tenant Appearance setting reactively', () => {
    snapshot.set({ 'appearance.date_format': 'yyyy-MM-dd' });

    expect(service.pattern()).toBe('yyyy-MM-dd');
    expect(service.format(JAN_15)).toBe('2026-01-15');
  });

  it('formats with the default pattern', () => {
    expect(service.format(JAN_15)).toBe('January 15, 2026');
    expect(service.format(new Date(JAN_15))).toBe('January 15, 2026');
  });

  it('lets an explicit pattern argument override the tenant setting', () => {
    snapshot.set({ 'appearance.date_format': 'yyyy-MM-dd' });

    expect(service.format(JAN_15, 'M/d/yy')).toBe('1/15/26');
  });

  it('renders nothing for nullish or empty input so callers can place their own placeholder', () => {
    expect(service.format(null)).toBe('');
    expect(service.format(undefined)).toBe('');
    expect(service.format('')).toBe('');
  });

  it('echoes unparseable input as-is instead of throwing', () => {
    expect(service.format('not-a-date')).toBe('not-a-date');
  });

  it('survives an invalid pattern by echoing the raw value', () => {
    snapshot.set({ 'appearance.date_format': '💥 not a pattern %%%' });

    // formatDate throws on garbage patterns; the service must not propagate that.
    expect(() => service.format(JAN_15)).not.toThrow();
  });
});
