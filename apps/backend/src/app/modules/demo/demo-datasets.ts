import type { OrgMode } from '../../../../../../libs/common/src';

import type { DemoDataset } from './demo-data-types';
import { CAMPAIGN_DEMO_DATASET } from './demo-seed-data';

/**
 * Which demo workspace each organization mode is seeded with at signup.
 *
 * A TOTAL Record, so adding an organization mode is a compile error here until someone decides
 * what its new workspace should contain — rather than the mode quietly landing in an empty CRM.
 *
 * `null` means "no dataset written for this mode yet", NOT "this mode should stay empty". The
 * standing decision is that every mode gets a demo workspace; nonprofit and church are null only
 * until their datasets are authored. `ORG_MODE_SEEDS_DEMO` in libs/common mirrors this table for
 * the frontend (which cannot import backend code) and `demo-datasets.spec.ts` proves the two
 * agree — flipping one without the other is caught there, not in production.
 */
export const DEMO_DATASETS: Record<OrgMode, DemoDataset | null> = {
  office: CAMPAIGN_DEMO_DATASET,
  campaign: CAMPAIGN_DEMO_DATASET,
  nonprofit: null,
  church: null,
};

/** The demo workspace for a mode, or null when that mode has no dataset yet. */
export function demoDatasetFor(mode: OrgMode): DemoDataset | null {
  return DEMO_DATASETS[mode];
}
