import { computed, inject, Service } from '@angular/core';
import { formatDate } from '@angular/common';
import { DEFAULT_TIMEZONE, isValidTimeZone, timeZoneOffsetString } from '@common';

import { SettingsService } from '../../experiences/settings/services/settings-service';

const DEFAULT_DATE_FORMAT = 'MMMM d, yyyy';

/**
 * Resolves the tenant-wide date presentation (Workspace → Organization) and formats date values
 * with it. Backed by the settings snapshot signal so changes propagate without a reload.
 *
 * Dates render in the *workspace* time zone, not the viewer's: a campaign in Toronto reading the
 * dashboard from an airport in Berlin should still see the day their work actually happened on.
 */
@Service()
export class DateFormatService {
  private readonly settings = inject(SettingsService);

  /** The configured date format pattern, falling back to the project default. */
  public readonly pattern = computed<string>(() => {
    const raw = this.settings.snapshotSignal()['appearance.date_format'];
    return typeof raw === 'string' && raw.trim() ? raw : DEFAULT_DATE_FORMAT;
  });

  /** The workspace's IANA zone, falling back to the project default. */
  public readonly timeZone = computed<string>(() => {
    const raw = this.settings.snapshotSignal()['organization.timezone'];
    return isValidTimeZone(raw) ? raw : DEFAULT_TIMEZONE;
  });

  /**
   * Formats a date value with the tenant's configured pattern. Returns an empty string for nullish or
   * unparseable input so callers can render their own placeholder.
   */
  public format(value: string | number | Date | null | undefined, pattern?: string): string {
    if (value === null || value === undefined || value === '') return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return String(value);
    try {
      // formatDate takes a UTC offset, not an IANA name, and the offset depends on the instant
      // (DST) — so it is resolved per value rather than cached.
      return formatDate(
        date,
        pattern ?? this.pattern(),
        'en-US',
        timeZoneOffsetString(date.getTime(), this.timeZone()),
      );
    } catch {
      return String(value);
    }
  }
}
