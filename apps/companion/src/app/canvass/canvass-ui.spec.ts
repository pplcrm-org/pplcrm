import { describe, expect, it } from 'vitest';

import type { CompanionLastKnock, KnockResponse } from '@common';

import { lastVisitLabel, personResultLabel, timeAgoLabel } from './canvass-ui';

const NOW = Date.parse('2026-08-07T18:00:00.000Z');

function visit(over: Partial<CompanionLastKnock> = {}): CompanionLastKnock {
  return { canvasser_name: 'Julie L.', conversation: true, at: new Date(NOW - 60_000).toISOString(), ...over };
}

describe('timeAgoLabel', () => {
  it('says "just now" under a minute', () => {
    expect(timeAgoLabel(0)).toBe('just now');
    expect(timeAgoLabel(59_000)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(timeAgoLabel(60_000)).toBe('1 minute ago');
    expect(timeAgoLabel(12 * 60_000)).toBe('12 minutes ago');
    expect(timeAgoLabel(2 * 3_600_000)).toBe('2 hours ago');
    expect(timeAgoLabel(26 * 3_600_000)).toBe('1 day ago');
    expect(timeAgoLabel(9 * 86_400_000)).toBe('9 days ago');
  });
});

describe('lastVisitLabel', () => {
  it('names the canvasser and how long ago', () => {
    expect(
      lastVisitLabel(visit({ at: new Date(NOW - 26 * 3_600_000).toISOString() }), { myName: 'Mai N.', now: NOW }),
    ).toBe('Julie L. spoke to someone here 1 day ago');
  });

  it('distinguishes a door that was only tried from a conversation', () => {
    expect(lastVisitLabel(visit({ conversation: false }), { myName: null, now: NOW })).toBe(
      'Julie L. tried this door 1 minute ago',
    );
  });

  it('says "You" for this volunteer\'s own knock', () => {
    expect(lastVisitLabel(visit(), { myName: 'julie l.', now: NOW })).toBe('You spoke to someone here 1 minute ago');
  });

  it('falls back to "Someone" when the knock carried no name', () => {
    expect(lastVisitLabel(visit({ canvasser_name: null }), { myName: 'Mai N.', now: NOW })).toBe(
      'Someone spoke to someone here 1 minute ago',
    );
  });

  it('reads a clock-skewed future timestamp as "just now" rather than a negative', () => {
    expect(lastVisitLabel(visit({ at: new Date(NOW + 600_000).toISOString() }), { myName: null, now: NOW })).toBe(
      'Julie L. spoke to someone here just now',
    );
  });

  it('is null with no recent visit, and on an unparseable timestamp', () => {
    expect(lastVisitLabel(null, { myName: null, now: NOW })).toBeNull();
    expect(lastVisitLabel(visit({ at: 'not a date' }), { myName: null, now: NOW })).toBeNull();
  });
});

describe('personResultLabel', () => {
  it('names the stance a survey recorded', () => {
    expect(personResultLabel('canvassed', 'supporter')).toBe('Supporter');
  });

  it('never returns an empty chip for a stance the vocabulary no longer names', () => {
    // A knock row written before the door vocabulary changed, arriving over the wire the
    // only way it can: parsed, and typed on trust. An empty chip is colour and nothing else.
    const stale: { support: KnockResponse | null } = JSON.parse('{"support":"strong_support"}');
    expect(personResultLabel('canvassed', stale.support)).toBe('Surveyed');
  });
});
