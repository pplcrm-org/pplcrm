/**
 * The electoral CSV-import columns moved to the shared schema library so the background job can
 * validate rows against the same field map: see
 * `libs/common/src/lib/schemas/import-rows.schema.ts`. This re-export keeps the historical
 * backend path working (`electoral-import-schema.spec.ts` and any other local caller).
 */
export { ELECTORAL_IMPORT_ROW_FIELDS } from '../../../../../../libs/common/src';
