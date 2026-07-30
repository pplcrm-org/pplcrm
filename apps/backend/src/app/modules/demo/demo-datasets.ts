import type { OrgMode } from '../../../../../../libs/common/src';

import type { DemoDataset } from './demo-data-types';
import { CHURCH_DEMO_DATASET } from './demo-data-church';
import { NONPROFIT_DEMO_DATASET } from './demo-data-nonprofit';
import { OFFICE_DEMO_DATASET } from './demo-data-office';
import { CAMPAIGN_DEMO_DATASET } from './demo-seed-data';

/**
 * Which demo workspace each organization mode is seeded with at signup.
 *
 * A TOTAL Record, so adding an organization mode is a compile error here until someone decides
 * what its new workspace should contain — rather than the mode quietly landing in an empty CRM.
 *
 * `null` would mean "no dataset written for this mode yet", NOT "this mode should stay empty" —
 * every mode gets a demo workspace. `ORG_MODE_SEEDS_DEMO` in libs/common mirrors this table for
 * the frontend (which cannot import backend code) and `demo-datasets.spec.ts` proves the two
 * agree — flipping one without the other is caught there, not in production.
 */
export const DEMO_DATASETS: Record<OrgMode, DemoDataset | null> = {
  // Office and campaign share a rolodex, not a workspace: the office dataset reuses the same
  // people and addresses (see demo-data-office.ts) but replaces the sign drops with casework and
  // seeds no donor ledger, because office mode starts with Donations off.
  office: OFFICE_DEMO_DATASET,
  campaign: CAMPAIGN_DEMO_DATASET,
  nonprofit: NONPROFIT_DEMO_DATASET,
  church: CHURCH_DEMO_DATASET,
};

/** The demo workspace for a mode, or null when that mode has no dataset yet. */
export function demoDatasetFor(mode: OrgMode): DemoDataset | null {
  return DEMO_DATASETS[mode];
}
