import { z } from 'zod';
import { getAllOptions, nameSchema, descriptionSchema, idSchema } from './core.schema';
import { SYSTEM_LIST_KEYS } from '../system-lists';

export const AddListObj = z.object({
  /** Campaigns §15 — the context this segment belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: nameSchema('List name', 100),
  description: descriptionSchema(1000),
  object: z.enum(['people', 'households']),
  is_dynamic: z.boolean().optional(),
  definition: z
    .lazy(() => getAllOptions)
    .nullable()
    .optional(),
  member_ids: z.array(idSchema).optional(),
});

export const ListsObj = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  object: z.enum(['people', 'households']),
  is_dynamic: z.boolean().optional(),
  definition: z
    .lazy(() => getAllOptions)
    .nullable()
    .optional(),
  last_refreshed_at: z.coerce.date().nullable().optional(),
  status: z.enum(['idle', 'refreshing', 'failed']).optional(),
  /**
   * Built-in list marker (§8) — set on the two lists the product owns and
   * re-creates. Read-only: it is absent from Add/Update on purpose, so no
   * client can mint or un-mint a built-in.
   */
  system_key: z.enum(SYSTEM_LIST_KEYS).nullable().optional(),
});

export const UpdateListObj = z.object({
  name: nameSchema('List name', 100).optional(),
  description: descriptionSchema(1000).optional(),
  object: z.enum(['people', 'households']).optional(),
  is_dynamic: z.boolean().optional(),
  definition: z
    .lazy(() => getAllOptions)
    .nullable()
    .optional(),
  last_refreshed_at: z.coerce.date().nullable().optional(),
  status: z.enum(['idle', 'refreshing', 'failed']).optional(),
});

export const ImportListItemObj = z.object({
  id: idSchema,
  fileName: z.string(),
  source: z.string(),
  tagName: z.string().nullable(),
  tagMissing: z.boolean(),
  createdAt: z.coerce.date(),
  processedAt: z.coerce.date(),
  createdBy: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
  insertedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  tagsApplied: z.array(z.string()),
  rowCount: z.number().int().nonnegative(),
  householdsCreated: z.number().int().nonnegative(),
  contactCount: z.number().int().nonnegative(),
  householdCount: z.number().int().nonnegative(),
  companyCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  status: z.string(),
  errorMessage: z.string().nullable().optional(),
  canDeleteContacts: z.boolean(),
  /** File size in bytes, when the original upload is still retained (90 days, spec §17). */
  sourceFileSize: z.number().int().nonnegative().nullable(),
  canDownloadSource: z.boolean(),
  canDownloadSkipped: z.boolean(),
});
