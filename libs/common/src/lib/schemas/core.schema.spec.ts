import { describe, it, expect } from 'vitest';
import {
  cloneQueryBuilderNode,
  dbIdSchema,
  descriptionSchema,
  emailSchema,
  getAllOptions,
  idSchema,
  MAX_PAGE_SIZE,
  nameSchema,
  notesSchema,
  nullableEmailSchema,
  phoneSchema,
  queryBuilderNodeSchema,
  uuidSchema,
  type QueryBuilderGroupNode,
} from './core.schema';

describe('nameSchema', () => {
  const schema = nameSchema('Name');

  it('trims and accepts a normal name', () => {
    expect(schema.parse('  Ada Lovelace  ')).toBe('Ada Lovelace');
  });

  it('rejects empty and whitespace-only input with the field name in the message', () => {
    const result = schema.safeParse('   ');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Name is required');
  });

  it('enforces the length cap with a field-specific message', () => {
    const result = nameSchema('Title', 10).safeParse('x'.repeat(11));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Title is too long');
  });
});

describe('descriptionSchema / notesSchema / phoneSchema', () => {
  it('descriptionSchema allows null, undefined, and trims strings', () => {
    const schema = descriptionSchema();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse('  hi  ')).toBe('hi');
    expect(schema.safeParse('x'.repeat(1001)).success).toBe(false);
  });

  it('notesSchema caps at 10000 characters', () => {
    expect(notesSchema.safeParse('x'.repeat(10000)).success).toBe(true);
    expect(notesSchema.safeParse('x'.repeat(10001)).success).toBe(false);
  });

  it('phoneSchema is optional and carries the field name in its error', () => {
    const schema = phoneSchema('Mobile');
    expect(schema.parse(null)).toBeNull();
    const result = schema.safeParse('9'.repeat(31));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Mobile is too long');
  });
});

describe('emailSchema / nullableEmailSchema', () => {
  it('accepts a valid address and rejects garbage', () => {
    expect(emailSchema.parse(' a@b.co ')).toBe('a@b.co');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('x'.repeat(320) + '@b.co').success).toBe(false);
  });

  it('nullableEmailSchema additionally allows empty string, null, and undefined', () => {
    expect(nullableEmailSchema.parse('')).toBe('');
    expect(nullableEmailSchema.parse(null)).toBeNull();
    expect(nullableEmailSchema.parse(undefined)).toBeUndefined();
    expect(nullableEmailSchema.safeParse('nope').success).toBe(false);
  });
});

describe('id schemas', () => {
  it('dbIdSchema (and its idSchema alias) accept only digit strings', () => {
    expect(dbIdSchema.parse('123')).toBe('123');
    expect(idSchema.safeParse('12a').success).toBe(false);
    expect(idSchema.safeParse('').success).toBe(false);
  });

  it('uuidSchema validates UUID shape', () => {
    expect(uuidSchema.safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true);
    expect(uuidSchema.safeParse('123').success).toBe(false);
  });
});

describe('queryBuilderNodeSchema', () => {
  const tree: QueryBuilderGroupNode = {
    kind: 'group',
    id: 'root',
    conjunction: 'AND',
    rules: [
      { kind: 'rule', id: 'r1', field: 'name', op: 'contains', value: 'a' },
      { kind: 'group', id: 'g1', conjunction: 'OR', rules: [{ kind: 'rule', id: 'r2', field: 'city', op: 'eq' }] },
    ],
  };

  it('accepts arbitrarily nested rule/group trees', () => {
    expect(queryBuilderNodeSchema.safeParse(tree).success).toBe(true);
  });

  it('rejects unknown kinds and bad conjunctions', () => {
    expect(queryBuilderNodeSchema.safeParse({ kind: 'other', id: 'x' }).success).toBe(false);
    expect(queryBuilderNodeSchema.safeParse({ kind: 'group', id: 'g', conjunction: 'NOR', rules: [] }).success).toBe(
      false,
    );
  });

  it('cloneQueryBuilderNode deep-clones groups so mutations cannot leak back', () => {
    const clone = cloneQueryBuilderNode(tree) as QueryBuilderGroupNode;

    expect(clone).toEqual(tree);
    expect(clone).not.toBe(tree);
    expect(clone.rules).not.toBe(tree.rules);
    expect(clone.rules[1]).not.toBe(tree.rules[1]);
    expect((clone.rules[1] as QueryBuilderGroupNode).rules[0]).not.toBe(
      (tree.rules[1] as QueryBuilderGroupNode).rules[0],
    );
  });
});

describe('getAllOptions', () => {
  it('is fully optional', () => {
    expect(getAllOptions.parse(undefined)).toBeUndefined();
  });

  it('accepts the datagrid wire shape including campaignId and advanced filters', () => {
    const parsed = getAllOptions.parse({
      searchStr: 'ali',
      startRow: 0,
      endRow: 25,
      sortModel: [{ colId: 'name', sort: 'asc' }],
      filterModel: { city: { op: 'eq', value: 'Springfield' } },
      tags: ['donor'],
      campaignId: '7',
      advancedFilterModel: { kind: 'rule', id: 'r', field: 'name', op: 'contains', value: 'x' },
    });

    expect(parsed?.campaignId).toBe('7');
  });

  it('rejects malformed sort entries', () => {
    expect(getAllOptions.safeParse({ sortModel: [{ colId: 'name', sort: 'sideways' }] }).success).toBe(false);
  });

  // These four fields reach Kysely's .limit()/.offset() directly. Unbounded, a request could
  // pull every row in the tenant into memory; unvalidated, a negative or a float reaches Postgres
  // and errors out as a 500 rather than a 400.
  describe('pagination bounds', () => {
    it('accepts a realistic page', () => {
      expect(getAllOptions.safeParse({ limit: 25, offset: 100 }).success).toBe(true);
    });

    it('rejects a limit above MAX_PAGE_SIZE', () => {
      expect(getAllOptions.safeParse({ limit: MAX_PAGE_SIZE }).success).toBe(true);
      expect(getAllOptions.safeParse({ limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
    });

    it('rejects negative and fractional row counts', () => {
      for (const field of ['limit', 'offset', 'startRow', 'endRow'] as const) {
        expect(getAllOptions.safeParse({ [field]: -1 }).success).toBe(false);
        expect(getAllOptions.safeParse({ [field]: 1.5 }).success).toBe(false);
      }
    });

    it('still allows a large offset, which is not a memory bound', () => {
      expect(getAllOptions.safeParse({ offset: MAX_PAGE_SIZE * 10 }).success).toBe(true);
    });
  });
});
