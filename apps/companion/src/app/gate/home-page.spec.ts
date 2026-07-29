import { describe, expect, it } from 'vitest';

import { normalizeJoinCode } from './home-page';

/**
 * The root page is what a volunteer reaches for when the camera fails, so the field has
 * to forgive how a code is actually read off a poster: lowercase, spaced, hyphenated.
 */
describe('normalizeJoinCode', () => {
  it('uppercases and keeps a clean code intact', () => {
    expect(normalizeJoinCode('4vgxxsbn')).toBe('4VGXXSBN');
  });

  it('drops separators someone types or pastes', () => {
    expect(normalizeJoinCode('4VGX-XSBN')).toBe('4VGXXSBN');
    expect(normalizeJoinCode(' 4vgx xsbn ')).toBe('4VGXXSBN');
  });

  it('drops characters the alphabet deliberately excludes', () => {
    // 0/O, 1/I/L and U are not in the alphabet, so they can only be a misread.
    expect(normalizeJoinCode('4VGX0XSBN')).toBe('4VGXXSBN');
  });

  it('never exceeds the code length', () => {
    expect(normalizeJoinCode('4VGXXSBNZZZZ')).toBe('4VGXXSBN');
  });
});
