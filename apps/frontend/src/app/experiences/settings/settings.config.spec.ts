import { isAuthRole } from '@common';
import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from './settings.config';

/**
 * Invariants over the declarative settings config. These caught a live defect: the
 * `access.default_role` picker offered the *label* 'editor' as a value, which is not an
 * AUTH_ROLE — the backend silently discarded it while the invite dialog sent it straight
 * through to `authusers.role`.
 */
describe('SETTINGS_SECTIONS', () => {
  const fields = SETTINGS_SECTIONS.flatMap((section) => section.fields);
  const selects = fields.filter((field) => field.type === 'select');

  it('offers only real auth roles as the default invite role', () => {
    const field = fields.find((f) => f.key === 'access.default_role');
    expect(field).toBeDefined();
    // The picker is populated statically, so an empty options list would silently pass below.
    expect(field?.options?.length).toBeGreaterThan(0);

    for (const option of field?.options ?? []) {
      expect(isAuthRole(option.value), `"${option.value}" is not an AuthRole`).toBe(true);
    }
    expect(isAuthRole(field?.defaultValue)).toBe(true);
  });

  it('gives every select a default that is one of its own options', () => {
    for (const field of selects) {
      // Some selects are populated at runtime (sending identity) and declare no static options.
      if (!field.options?.length || field.defaultValue === undefined) continue;

      const values = field.options.map((option) => option.value);
      expect(values, `${field.key} defaults to a value it does not offer`).toContain(field.defaultValue);
    }
  });

  it('keeps setting keys unique across sections', () => {
    const keys = fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
