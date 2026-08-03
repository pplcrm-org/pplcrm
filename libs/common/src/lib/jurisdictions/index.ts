import { CA_FEDERAL_JURISDICTION } from './ca-federal';
import { CA_MUNICIPAL_JURISDICTION } from './ca-municipal';
import { CA_PROVINCIAL_JURISDICTION } from './ca-provincial';
import { OTHER_JURISDICTION } from './other';
import { US_FEDERAL_JURISDICTION } from './us-federal';
import { US_LOCAL_JURISDICTION } from './us-local';
import { US_STATE_JURISDICTION } from './us-state';

import type { JurisdictionId, JurisdictionSpec } from './jurisdiction.types';

export * from './jurisdiction.types';
export * from './regions';
export { CA_FEDERAL_JURISDICTION } from './ca-federal';
export { CA_PROVINCIAL_JURISDICTION } from './ca-provincial';
export { CA_MUNICIPAL_JURISDICTION } from './ca-municipal';
export { US_FEDERAL_JURISDICTION, US_AT_LARGE_CONGRESSIONAL_STATES } from './us-federal';
export { US_STATE_JURISDICTION } from './us-state';
export { US_LOCAL_JURISDICTION } from './us-local';
export { OTHER_JURISDICTION } from './other';

/**
 * Every jurisdiction, keyed by id.
 *
 * The campaign form, the schema's cross-field validation, the label resolvers, the boundary-set
 * loader and the donations settings page all read this one record, so a fact stated in a spec file
 * is stated once for the whole product.
 */
export const JURISDICTIONS: Record<JurisdictionId, JurisdictionSpec> = {
  ca_federal: CA_FEDERAL_JURISDICTION,
  ca_provincial: CA_PROVINCIAL_JURISDICTION,
  ca_municipal: CA_MUNICIPAL_JURISDICTION,
  us_federal: US_FEDERAL_JURISDICTION,
  us_state: US_STATE_JURISDICTION,
  us_local: US_LOCAL_JURISDICTION,
  other: OTHER_JURISDICTION,
};
