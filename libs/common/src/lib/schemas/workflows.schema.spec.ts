import { describe, expect, it } from 'vitest';

import {
  DATE_ARRIVES_MAX_DAYS_BEFORE,
  WORKFLOW_STEP_KINDS,
  WORKFLOW_TRIGGER_TYPES,
  encodeDateArrivesConfig,
  lockedMessageClassForTrigger,
  parseDateArrivesConfig,
} from './workflows.schema';

describe('date_arrives config codec', () => {
  it('round-trips a valid config through encode and parse', () => {
    const config = { days_before: 14, campaign_id: '7', list_id: '42' };
    expect(parseDateArrivesConfig(encodeDateArrivesConfig(config))).toEqual(config);
  });

  it('accepts 0 days before (fire on the end date itself)', () => {
    const config = { days_before: 0, campaign_id: '7', list_id: '42' };
    expect(parseDateArrivesConfig(encodeDateArrivesConfig(config))).toEqual(config);
  });

  it('returns null for null, empty, non-JSON and wrong-shape input — the cron treats all of those as "not configured"', () => {
    expect(parseDateArrivesConfig(null)).toBeNull();
    expect(parseDateArrivesConfig(undefined)).toBeNull();
    expect(parseDateArrivesConfig('')).toBeNull();
    expect(parseDateArrivesConfig('90')).toBeNull();
    expect(parseDateArrivesConfig('not json')).toBeNull();
    expect(parseDateArrivesConfig(JSON.stringify({ days_before: 14 }))).toBeNull();
    expect(parseDateArrivesConfig(JSON.stringify({ days_before: 14, campaign_id: '', list_id: '42' }))).toBeNull();
  });

  it('rejects out-of-range and non-integer day counts', () => {
    expect(parseDateArrivesConfig(JSON.stringify({ days_before: -1, campaign_id: '7', list_id: '42' }))).toBeNull();
    expect(
      parseDateArrivesConfig(
        JSON.stringify({ days_before: DATE_ARRIVES_MAX_DAYS_BEFORE + 1, campaign_id: '7', list_id: '42' }),
      ),
    ).toBeNull();
    expect(parseDateArrivesConfig(JSON.stringify({ days_before: 1.5, campaign_id: '7', list_id: '42' }))).toBeNull();
    expect(() => encodeDateArrivesConfig({ days_before: -1, campaign_id: '7', list_id: '42' })).toThrow();
  });
});

describe('message classing of the field-ops triggers', () => {
  it('sign_delivered and event_registered are relationship-locked — both respond to the recipient’s own request', () => {
    expect(lockedMessageClassForTrigger('sign_delivered')).toBe('relationship');
    expect(lockedMessageClassForTrigger('event_registered')).toBe('relationship');
  });

  it('date_arrives stays ambiguous (author picks; defaults to marketing, the safe side)', () => {
    expect(lockedMessageClassForTrigger('date_arrives')).toBeNull();
  });

  it('the new triggers and step kind are in the shared enums', () => {
    expect(WORKFLOW_TRIGGER_TYPES).toContain('sign_delivered');
    expect(WORKFLOW_TRIGGER_TYPES).toContain('event_registered');
    expect(WORKFLOW_STEP_KINDS).toContain('add_to_list');
  });
});
