import { z } from 'zod';

export const sortModelItem = z.object({
  colId: z.string(),
  sort: z.enum(['asc', 'desc']),
});

export interface QueryBuilderRuleNode {
  kind: 'rule';
  id: string;
  field: string;
  op: string;
  value?: any;
}

export interface QueryBuilderGroupNode {
  kind: 'group';
  id: string;
  conjunction: 'AND' | 'OR';
  rules: QueryBuilderNode[];
}

export type QueryBuilderNode = QueryBuilderRuleNode | QueryBuilderGroupNode;

export function cloneQueryBuilderNode(node: QueryBuilderNode): QueryBuilderNode {
  if (node.kind === 'rule') {
    return { ...node };
  } else {
    return {
      ...node,
      rules: node.rules.map(cloneQueryBuilderNode),
    };
  }
}

export const queryBuilderNodeSchema: z.ZodType<QueryBuilderNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('rule'),
      id: z.string(),
      field: z.string(),
      op: z.string(),
      value: z.unknown().optional(),
    }),
    z.object({
      kind: z.literal('group'),
      id: z.string(),
      conjunction: z.enum(['AND', 'OR']),
      rules: z.array(queryBuilderNodeSchema),
    }),
  ]),
);

export const oldAdvancedFilterModelSchema = z.object({
  conjunction: z.enum(['AND', 'OR']),
  rules: z.array(
    z.object({
      field: z.string(),
      op: z.string(),
      value: z.unknown(),
    }),
  ),
});

/**
 * Hard ceiling on how many rows one list request may ask for, and the default the repo applies
 * when a request derives no limit at all. Without this, `getAll` with no paging fields selected
 * every row in the tenant into memory — a request-sized denial of service on any large tenant.
 * Generous on purpose: real grid pages are in the tens, and the largest legitimate consumer
 * (an inline CSV export) sets its own explicit limit and refuses past 50k rather than truncating.
 */
export const MAX_PAGE_SIZE = 5000;

/**
 * Ceiling on a bulk-action id list (delete these, archive those, assign this tag to them).
 * These become `where('id', 'in', ids)`, so an unbounded array is both a huge query and, for
 * destructive actions, an unbounded amount of work behind one request. 2000 matches the cap
 * already used by the duplicate-email check and is far above any real selection.
 */
export const MAX_BULK_IDS = 2000;

/** A row index/count: a non-negative integer, never a float or a negative that reaches Postgres. */
const rowCountSchema = z.number().int().min(0).max(MAX_PAGE_SIZE);
/** An offset can legitimately exceed one page's worth of rows, so it is bounded separately. */
const rowOffsetSchema = z.number().int().min(0);

export const getAllOptions = z
  .object({
    searchStr: z.string().optional(),
    startRow: rowOffsetSchema.optional(),
    endRow: rowOffsetSchema.optional(),
    sortModel: z.array(sortModelItem).optional(),
    filterModel: z.record(z.string(), z.unknown()).optional(),
    includeArchived: z.boolean().optional(),
    columns: z.array(z.string()).optional(),
    limit: rowCountSchema.optional(),
    offset: rowOffsetSchema.optional(),
    orderBy: z.array(z.string()).optional(),
    groupBy: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    issues: z.array(z.string()).optional(),
    type: z.enum(['tag', 'issue']).optional(),
    userId: z.string().optional(),
    entity: z.string().optional(),
    activity: z.string().optional(),
    advancedFilterModel: queryBuilderNodeSchema.or(oldAdvancedFilterModelSchema).optional(),
    listId: z.string().optional(),
    /** Campaigns §15 — the active context; scopes campaign-specific columns/rows (e.g. support level). */
    campaignId: z.string().optional(),
    /**
     * Volunteer/staff status filters (§15) — first-class replacements for the
     * old `tags: ['volunteer']` filter. Plain string arrays here to avoid a
     * circular import with persons.schema; the enum is validated at the column.
     */
    volunteerStatus: z.array(z.string()).optional(),
    staffStatus: z.array(z.string()).optional(),
  })
  .optional();

export const exportCsvInput = z
  .object({
    options: getAllOptions,
    columns: z.array(z.string()).optional(),
    fileName: z.string().optional(),
  })
  .optional();

export const exportCsvResponse = z.union([
  z.object({
    status: z.literal('processing'),
  }),
  z.object({
    csv: z.string(),
    fileName: z.string(),
    columns: z.array(z.string()),
    rowCount: z.number(),
    status: z.literal('completed').optional(),
  }),
]);

export const exportEntitySchema = z.enum([
  'persons',
  'households',
  'companies',
  'tags',
  'issues',
  'tasks',
  'lists',
  'newsletters',
  'teams',
  'users',
  'volunteer',
  'forms',
  'workflows',
]);

export const queueExportInput = z.object({
  entity: exportEntitySchema,
  options: getAllOptions,
  columns: z.array(z.string()).optional(),
  fileName: z.string().optional(),
});

/** Logs an export that already downloaded straight to the browser (small/displayed-rows path)
 * so it still shows up in the Exports history — see pplcrm-datagrid. No file is stored server-side,
 * so the resulting record is not re-downloadable. */
export const logInstantExportInput = z.object({
  entity: exportEntitySchema,
  fileName: z.string(),
  rowCount: z.number().int().nonnegative(),
});

export const dataExportRecord = z.object({
  id: z.string(),
  entity: z.string(),
  file_name: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  row_count: z.number().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  downloadable: z.boolean(),
  createdBy: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export const dbIdSchema = z.string().regex(/^\d+$/, 'Invalid ID format');
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const idSchema = dbIdSchema;

export const addressSchema = z.object({
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  formatted_address: z.string().trim().max(500, 'Address is too long').nullable().optional(),
  type: z.string().trim().max(50, 'Type is too long').nullable().optional(),
  apt: z.string().trim().max(30, 'Apt is too long').nullable().optional(),
  street_num: z.string().trim().max(30, 'Street number is too long').nullable().optional(),
  street1: z.string().trim().max(150, 'Street 1 is too long').nullable().optional(),
  street2: z.string().trim().max(150, 'Street 2 is too long').nullable().optional(),
  city: z.string().trim().max(100, 'City is too long').nullable().optional(),
  state: z.string().trim().max(100, 'State is too long').nullable().optional(),
  zip: z.string().trim().max(20, 'Zip is too long').nullable().optional(),
  country: z.string().trim().max(100, 'Country is too long').nullable().optional(),
});

/**
 * One column's server-side filter as the datagrid posts it inside `filterModel`:
 * an optional comparison `op` (contains/equals/startsWith/isEmpty/…) and the
 * `value` to match. Consumed by BaseRepository.applyColumnFilter /
 * applyCastColumnFilter. `value` is `unknown` because the grid sends strings,
 * numbers, and booleans — coerce with String(...) at the point of use. Matches
 * the wire shape validated by getAllOptions' `filterModel: z.record(z.unknown())`.
 */
export interface GridColumnFilter {
  op?: string;
  value?: unknown;
}

/** The datagrid's per-column filter bag: column id → its filter. */
export type GridFilterModel = Record<string, GridColumnFilter>;

export const nameSchema = (fieldName: string, maxLen = 100) =>
  z.string().trim().min(1, `${fieldName} is required`).max(maxLen, `${fieldName} is too long`);

export const descriptionSchema = (maxLen = 1000) =>
  z.string().trim().max(maxLen, 'Description is too long').nullable().optional();

export const emailSchema = z.string().trim().max(320, 'Email is too long').email('Invalid email address');

export const nullableEmailSchema = emailSchema.or(z.literal('')).nullable().optional();
export const phoneSchema = (fieldName: string) =>
  z.string().trim().max(30, `${fieldName} is too long`).nullable().optional();

export const notesSchema = z.string().trim().max(10000, 'Notes are too long').nullable().optional();
