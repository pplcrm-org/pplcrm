import type { PcTabOption } from '@uxcommon/components/tabs/tabs';

/**
 * The three sibling donation views, as route-linked pills (design §4). Defined once so the
 * bar reads identically on every page that renders it — a tab that only exists on two of the
 * three pages is how a tab bar starts lying about where you are.
 */
export const DONATION_TABS: PcTabOption[] = [
  { id: 'all', label: 'All', route: '/donations', exact: true },
  { id: 'one-time', label: 'One-time', route: '/donations/one-time' },
  { id: 'pledges', label: 'Monthly pledges', route: '/donations/pledges' },
  { id: 'receipts', label: 'Receipts & statements', route: '/donations/receipts' },
];

/** Which slice of the ledger a donations page is showing. */
export type DonationsScope = 'all' | 'one-time';
