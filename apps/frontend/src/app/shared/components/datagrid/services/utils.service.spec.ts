import { describe, expect, it } from 'vitest';

import { DataGridUtilsService } from './utils.service';

describe('DataGridUtilsService', () => {
  const svc = new DataGridUtilsService();

  describe('bucketByRoute', () => {
    it('groups node data by the JSON of their route array, dropping nodes without data', () => {
      const nodes = [
        { route: ['a'], data: { id: 1 } },
        { route: ['a'], data: { id: 2 } },
        { route: ['b'], data: { id: 3 } },
        { route: ['a'] }, // no data — key exists, nothing pushed
        'not-a-record', // non-record — lands under the empty-route key with no data
      ];
      const map = svc.bucketByRoute(nodes);
      expect(map.get(JSON.stringify(['a']))).toEqual([{ id: 1 }, { id: 2 }]);
      expect(map.get(JSON.stringify(['b']))).toEqual([{ id: 3 }]);
      expect(map.get(JSON.stringify([]))).toEqual([]);
    });
  });

  describe('createPayload', () => {
    it('extracts exactly the one keyed field, and returns an empty object when it is undefined', () => {
      expect(svc.createPayload<{ name?: string; age?: number }>({ name: 'Ada', age: 36 }, 'name')).toEqual({
        name: 'Ada',
      });
      expect(svc.createPayload<{ name?: string }>({}, 'name')).toEqual({});
    });
  });

  describe('tagsToString', () => {
    it('capitalizes, trims, drops empties, and joins with commas', () => {
      expect(svc.tagsToString([' donor', 'VOLUNTEER', '', '  '])).toBe('Donor, VOLUNTEER');
      expect(svc.tagsToString([])).toBe('');
      // Defensive branch: a non-array reaches it as unknown input at grid seams.
      expect(svc.tagsToString(undefined as unknown as string[])).toBe('');
    });
  });

  describe('tagArrayEquals', () => {
    it('compares by joined string, tolerating null/undefined as empty', () => {
      expect(svc.tagArrayEquals(['a', 'b'], ['a', 'b'])).toBe(0);
      expect(svc.tagArrayEquals(['a'], ['b'])).toBeLessThan(0);
      expect(svc.tagArrayEquals(undefined as unknown as string[], [])).toBe(0);
    });
  });

  describe('normalizeTagSelection', () => {
    it('wraps scalars, trims, dedupes, and drops null/empty entries', () => {
      expect(svc.normalizeTagSelection('donor')).toEqual(['donor']);
      expect(svc.normalizeTagSelection([' donor ', 'donor', null, '', 42])).toEqual(['donor', '42']);
      expect(svc.normalizeTagSelection(null)).toEqual([]);
      expect(svc.normalizeTagSelection(undefined)).toEqual([]);
    });
  });
});
