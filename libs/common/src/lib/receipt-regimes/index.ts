import { CRA_CHARITY_REGIME } from './cra-charity';
import { POLITICAL_ALBERTA_REGIME } from './political-alberta';
import { POLITICAL_BC_REGIME } from './political-bc';
import { POLITICAL_FEDERAL_REGIME } from './political-federal';
import { POLITICAL_ONTARIO_REGIME } from './political-ontario';
import { POLITICAL_QUEBEC_REGIME } from './political-quebec';

import type { ReceiptRegimeId, ReceiptRegimeSpec } from './receipt-regime.types';

export * from './receipt-regime.types';
export { CRA_CHARITY_REGIME } from './cra-charity';
export { POLITICAL_FEDERAL_REGIME } from './political-federal';
export { POLITICAL_ONTARIO_REGIME } from './political-ontario';
export { POLITICAL_BC_REGIME } from './political-bc';
export { POLITICAL_ALBERTA_REGIME } from './political-alberta';
export { POLITICAL_QUEBEC_REGIME } from './political-quebec';

/** Every regime, keyed by id — the settings UI select and the PDF builder both read this. */
export const RECEIPT_REGIMES: Record<ReceiptRegimeId, ReceiptRegimeSpec> = {
  cra_charity: CRA_CHARITY_REGIME,
  political_federal: POLITICAL_FEDERAL_REGIME,
  political_on: POLITICAL_ONTARIO_REGIME,
  political_bc: POLITICAL_BC_REGIME,
  political_ab: POLITICAL_ALBERTA_REGIME,
  political_qc: POLITICAL_QUEBEC_REGIME,
};
